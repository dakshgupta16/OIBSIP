# Java Multithreading — Complete Guide for SDE 1 / SDE 2 (Expanded Edition)

**How to use this document:** Each "Part" is a self-contained chunk. Read them in order the first time. Every concept follows the same shape:

1. **The problem** — what breaks without it (so you can answer *"why can't I just do X?"*)
2. **The mental model** — plain-English explanation
3. **Code** — runnable, realistic
4. **Industry use case** — where this actually shows up in production systems
5. **Gotchas / interview traps**

**What's different in this edition:** the original guide is already unusually deep on Java-level concurrency — happens-before, CAS, AQS, virtual threads. But it constantly leans on *hardware and OS* vocabulary without ever teaching it: "each core has its own L1/L2 cache," "the JIT hoists the check," "a context switch costs 1–10 µs," "CAS is a single atomic CPU instruction," "the object header." If you don't already know what a cache line is, what bytecode is, what the OS scheduler actually does, or what's physically inside a Java object, those sentences are facts to memorize rather than things you understand. A new **Part F — Foundations** comes first and builds that hardware/OS/JVM picture from scratch, so that every later "why" in this guide is something you can *derive*, not just recall. Nothing else has been removed — every code sample, war story, and interview answer from the original is still here, just with deeper reasoning threaded through it and explicit pointers back to Part F wherever it's leaned on.

> **Java version note:** Everything here is Java 8+ unless marked. Sections marked 🆕 are Java 21+ (virtual threads, structured concurrency). Most companies in 2026 run Java 17 or 21.

---

## Table of Contents

| Part | Topic | Why it matters |
|---|---|---|
| F | Foundations — Hardware, OS, and JVM Vocabulary | What every later "why" is built on |
| 0 | Why Concurrency Exists | The foundation for every "why" question |
| 1 | Threads: Creation, Lifecycle, Control | The raw primitive |
| 2 | The Java Memory Model (JMM) | *The* most misunderstood topic. Explains 90% of weird bugs |
| 3 | `synchronized` and Intrinsic Locks | Mutual exclusion, the built-in way |
| 4 | `wait()` / `notify()` — Coordination | Producer-Consumer from scratch |
| 5 | Liveness Hazards: Deadlock, Livelock, Starvation | The bugs that page you at 3 AM |
| 6 | Explicit Locks (`ReentrantLock`, `ReadWriteLock`, `StampedLock`) | When `synchronized` isn't enough |
| 7 | Atomics & CAS (Lock-Free Programming) | High-throughput counters, non-blocking algorithms |
| 8 | Concurrent Collections | 99% of real code uses these, not raw locks |
| 9 | Executor Framework & Thread Pools | **The single most-used concurrency API in industry** |
| 10 | `CompletableFuture` — Async Composition | Microservice orchestration |
| 11 | Synchronizers: Latch, Barrier, Semaphore, Phaser | Coordination building blocks |
| 12 | `ThreadLocal` | Request context, and how it leaks memory |
| 13 | Immutability, Safe Publication, Thread Confinement | The *design* answer to concurrency |
| 14 | 🆕 Virtual Threads & Structured Concurrency | The Java 21 revolution |
| 15 | Performance: Contention, Context Switching, False Sharing | SDE-2 level tuning |
| 16 | Debugging & Testing Concurrent Code | Thread dumps, jstack, deadlock detection |
| 17 | Real-World System Designs | Rate limiter, connection pool, TTL cache, batcher |
| 18 | Cheat Sheets, Decision Trees & Interview Q&A | Revision |

---
---

# PART F — Foundations: The Hardware, OS, and JVM Vocabulary

Every later part in this guide uses words like "cache," "register," "bytecode," "context switch," "monitor," and "syscall" as if you already have a picture in your head for each. This part builds that picture, once, from the ground up — a physical, mechanical understanding of what a CPU, an operating system, and the JVM are each actually doing while your Java code runs. Skim any section you already know cold; read closely any heading that's currently just a word to you.

## F1. What a program actually is while it runs: the call stack and the program counter

A running thread is, physically, two things the CPU keeps track of: a **program counter** (a number saying "which instruction executes next") and a **call stack** — a stack (last-in-first-out) of **stack frames**, one per method call currently in progress. Calling a method pushes a new frame holding that method's local variables, its parameters, and the address to return to when it finishes; returning from a method pops that frame off. This is why a local variable inside a method is automatically safe to use without any synchronization even in heavily concurrent code (Part 13.4's "stack confinement") — each thread has its **own, separate** call stack, so two threads calling the same method at the same time each get their own independent copy of that method's local variables. They are not looking at the same memory at all.

This is also the concrete reason a `Thread` reserves roughly 1 MB of memory just to *exist*, before it's done any work (Part 0.5, Part 9.1): that reserved block is space for its call stack to grow into as method calls nest deeper. A **virtual thread** (Part 14) sidesteps this specific cost by keeping its stack as a small, resizable object on the heap instead of a fixed OS-allocated block — more on exactly how in F5 and Part 14.

A **register** is a tiny, extremely fast storage location built directly into the CPU core itself — there are only a handful of them (a few dozen on a typical modern CPU), and reading/writing one is far faster than reading/writing any location in RAM. Compilers try hard to keep a value a program is actively using in a register rather than in memory, because it's dramatically cheaper to access. This is the mechanism behind Part 2.3's third culprit for visibility bugs: if a loop only ever reads a `boolean` field and the compiler can prove (in a single-threaded reading of the code) that nothing changes it, the compiler is free to load it into a register **once** and keep re-checking that register forever, never looking at main memory again — which is exactly why a plain, non-`volatile` flag can make a loop spin forever even after another thread "changed" it.

## F2. CPU cores, the memory hierarchy, and why caches exist

Fetching a value from main memory (RAM) takes roughly 100 nanoseconds — by CPU standards, an eternity; a modern core can execute several *hundred* instructions in that time. If every read and write went straight to RAM, the CPU would spend nearly all its time waiting. The fix is a **memory hierarchy**: a stack of storage tiers between the CPU and RAM, each smaller but dramatically faster than the one below it.

```
CPU core ── L1 cache (~1 ns, tiny, per-core)
         ── L2 cache (~4 ns, bigger, per-core or per-core-pair)
         ── L3 cache (shared across all cores on the chip)
         ── Main memory / RAM (~100 ns)
```

Whenever a core reads a piece of memory, it doesn't fetch just that one value — it pulls in a whole **64-byte cache line** containing it (a chunk of nearby memory, on the bet that you'll want the neighbors next) and keeps that line in its own L1/L2 cache for fast re-reading. This is a huge win for a single thread. It's the *source* of the visibility problem in Part 2.3: when thread A writes to a variable, that write initially lands in thread A's **own core's** cache line, not immediately in RAM and not immediately in thread B's cache. If thread B is reading its own stale cached copy of that same cache line, it can keep seeing the old value indefinitely, with nothing to tell it a newer value exists elsewhere — exactly the "Core 1 / Core 2" diagram Part 2.3 shows.

Modern CPUs run a **cache coherence protocol** (commonly a variant called MESI) in hardware to manage this: when one core writes to a cache line, the protocol detects that other cores hold a now-stale copy of the *same* line and invalidates theirs, forcing them to re-fetch on next read. This keeps things *eventually* consistent across cores automatically — but "eventually," left ungoverned, isn't good enough for correctness, and coherence traffic itself has a real cost. That cost is exactly what Part 15.3's **false sharing** is about: if two threads write to two *different* variables that happen to sit inside the *same* 64-byte cache line, the coherence protocol treats every write as invalidating the *whole line* for the other core — so two threads touching logically-unrelated data end up fighting over cache-line ownership as if they were sharing a single variable, and pay the coherence cost on every single write.

## F3. Memory barriers (fences) — what `volatile` and `synchronized` physically insert

A **memory barrier** (or **fence**) is a special CPU instruction that restricts how reads and writes can be reordered around it, and that forces certain effects to become visible across cores before execution continues past it. There are, conceptually, two directions:

- A **store/release barrier** ensures every write *before* the barrier (in program order) is flushed out of this core's local cache and made visible to other cores *before* the barrier's own write becomes visible. This is what a `volatile` write inserts.
- A **load/acquire barrier** ensures every read *after* the barrier sees the freshest data — it forbids the CPU from speculatively reading memory from *before* the barrier completes, and it forces a fresh fetch rather than trusting a possibly-stale local cache line. This is what a `volatile` read inserts.

This is the literal hardware mechanism underneath Part 2.6's "happens-before" and the "piggyback pattern": a volatile write acting as a release barrier is what actually flushes *everything* written before it (not just the volatile field itself) out to where other cores can see it, and the paired volatile read acting as an acquire barrier is what actually forces the reading thread to fetch fresh data rather than trust a stale cache line. `synchronized` inserts the same kind of barriers on lock acquire (acquire semantics) and release (release semantics) — which is *why* Part 3.1 can truthfully say `synchronized` gives you visibility, not just mutual exclusion: the barriers are a side effect of entering and leaving the monitor, not a separate mechanism.

Barriers are not free — they're why Part 15.1's cost table shows an uncontended lock at ~20ns instead of the ~1ns of a plain register operation: even with no other thread involved at all, the barrier instructions themselves take real cycles to execute, because they must genuinely interact with the cache-coherence hardware described in F2.

## F4. From source code to running instructions: bytecode and the JIT

Java source code doesn't run directly. `javac` compiles it into **bytecode** — a compact, platform-independent instruction set (things like `getfield`, `iadd`, `putfield`, the three steps Part 2.2 breaks `count++` into) stored in `.class` files. The JVM starts out **interpreting** this bytecode, executing it instruction by instruction — correct, but slow, since each bytecode instruction itself has to be decoded and dispatched every single time it runs.

For code that runs a lot (a "hot" method, detected by simple invocation counters the JVM keeps), the **JIT (Just-In-Time) compiler** kicks in and compiles that bytecode down to genuine native machine code for your specific CPU, on the fly, while the program is still running — and it does this with the benefit of runtime information the static `javac` compiler never had (which branches are actually taken, which types actually show up, whether a variable is ever really written by another thread as far as it's observed so far). This is *why* the JIT is able to perform the aggressive optimizations Part 2.5 and Part 3.5 describe — hoisting a repeated field read out of a loop, eliding a lock entirely, inlining a virtual call — none of these are things the interpreter does; they're compilation-time decisions made by a compiler running *inside* your live process, based on what it's observed the code doing so far. All of them are legal specifically because the JMM only promises correct behavior for a **single thread's own view** of its code unless you've told the compiler otherwise (via `volatile`, `synchronized`, or an explicit happens-before edge) — the JIT has no way to know your field is shared unless the bytecode itself carries that information, which is exactly what the `volatile` modifier does: it's a promise, encoded in the class file, that this compiler must not apply those particular optimizations to this field.

## F5. The operating system: scheduling, context switches, and syscalls

Below the JVM sits the operating system, which is what actually decides which thread gets to run on which core, and for how long. The OS **scheduler** maintains a queue of runnable threads (across the *entire machine*, every process) and periodically preempts whichever thread is currently running on a core to give another one a turn — this is what makes "concurrency on one core" (Part 0.2) possible at all: the illusion of simultaneity created by switching fast enough that a human can't perceive the gaps.

A **context switch** is the OS doing that handoff: saving the outgoing thread's register contents and program counter (F1) somewhere safe, loading the incoming thread's saved registers and program counter, and resuming it exactly where it left off. This is genuinely expensive — not just the save/restore bookkeeping itself, but the fact that the incoming thread's data is very unlikely to still be sitting in this core's L1/L2 cache (F2), so its first several memory accesses after the switch are slow cache misses. This is the concrete reason Part 15.1's cost table lists a context switch as roughly 1000× more expensive than an uncontended lock.

A **syscall** (system call) is how a program running in restricted "user mode" asks the kernel (running in privileged "kernel mode") to do something only the kernel is allowed to do — read a file, send on a socket, or, relevantly here, **block a thread and take it off the scheduler's runnable queue** until some condition is met. When a Java thread calls `LockSupport.park()` (the mechanism under `Object.wait()`, `Thread.join()`, and every `AQS`-based lock's blocking path — Part 6.6), it is ultimately making a syscall that tells the OS "don't schedule me again until someone calls `unpark` on me." That thread then costs the OS literally nothing in CPU time while parked — but *un*-parking it later requires another context switch to actually get it running again, which is why "blocking" is cheap while idle but has a real, measurable cost to enter and exit, and why a CAS retry loop (Part 7.2), which never asks the OS to do any of this, can be so much cheaper under light contention: it never leaves user mode at all.

## F6. What's actually inside a Java object: headers and monitors

Every object on the Java heap carries a small amount of bookkeeping in addition to its declared fields, called the **object header** — typically 8–16 bytes on a modern 64-bit JVM, made up of a **mark word** (holding, at different times, the object's identity hash code, GC-related bits, and — critically for this guide — its **lock state**) and a pointer to the object's class metadata.

This is the literal, physical location of "every Java object's invisible lock" that Part 3.1 describes. There is no separate lock object allocated somewhere else — the lock state lives *inside* the mark word of the object itself. This is exactly why Part 3.5's lock optimizations are possible and why they're staged the way they are:

- **Thin/lightweight locking**: an uncontended `synchronized` can record "locked, by this thread" using a single CAS (F7/Part 7.2) directly on the object's own mark word — no separate OS-level construct is created or touched at all, which is why it costs only ~20ns.
- **Lock inflation**: only once a *second* thread genuinely contends for the same object does the JVM "inflate" that lightweight mark-word record into a full, heavyweight monitor — an OS-backed structure capable of actually parking a thread (F5) and maintaining a wait queue for `wait()`/`notify()` (Part 4). This is why an uncontended `synchronized` block is cheap and a contended one suddenly costs orders of magnitude more (Part 15.1): they are, physically, using two different mechanisms, and the JVM only pays for the expensive one once contention actually shows up.

This also explains why `Part 3.2`'s trap (locking on `this` vs `Example.class`) is really about *which object's mark word* gets touched: `synchronized` on an instance method locks the mark word of `this`; `synchronized` on a static method locks the mark word of the `Class` object representing `Example` (every loaded class has exactly one `Class` object living on the heap, itself lockable like any other object) — two entirely different pieces of memory, hence two entirely independent locks.

## F7. What "atomic" formally means, and CAS as a hardware instruction

An operation is **atomic** if, from the point of view of every other thread in the system, it appears to happen as a single, indivisible step — there is no possible instant at which another thread could observe it "half done." A plain `int` field write in Java happens to be atomic (the JLS guarantees it, except for `long`/`double` without `volatile` — Part 2.4's word-tearing note) simply because it fits in one machine word and the hardware moves it in one step. `count++`, by contrast, is *not* atomic — as Part 2.2 shows, it's actually three separate steps (read, add, write), and "atomic" is a claim about the *whole compound operation*, not about each individual step in isolation.

**Compare-and-swap (CAS)**, introduced in full in Part 7.2, is special precisely because the hardware itself — not any code you write — guarantees the read-compare-write sequence happens as one atomic unit, with no other core able to interject in the middle. This is implemented as a genuine single CPU instruction (`CMPXCHG` on x86, a `LDREX`/`STREX` load-linked/store-conditional pair on ARM), meaning the atomicity guarantee doesn't come from disabling interrupts or acquiring any OS-level lock (F5) — it's enforced directly by the memory-coherence hardware from F2, which is what lets it stay so much cheaper than a syscall-based block under light contention.

## F8. Generics and functional interfaces, quick reference

This guide's code samples lean on two Java-language features constantly, starting from Part 1's very first example — worth having crisp before you read further if either is new to you.

A **generic type**, written with angle brackets like `Callable<V>` or `Future<V>`, is a class or interface parameterized by another type: `Callable<BigDecimal>` means "a task that, when run, produces a `BigDecimal`." This lets the compiler check, at compile time, that a `Future<BigDecimal>`'s `.get()` really does hand you a `BigDecimal` and not some other type — without generics, everything would have to flow through as a bare `Object`, requiring a manual, unchecked cast at every retrieval, with a `ClassCastException` waiting at runtime for the first mismatch nobody caught by inspection.

A **functional interface** is an interface with exactly one abstract method — `Runnable` (`void run()`), `Callable<V>` (`V call()`), `Supplier<T>` (`T get()`), `Consumer<T>` (`void accept(T t)`). Because there's only one method to implement, Java lets you write a **lambda expression** — a compact, inline, unnamed implementation — anywhere one of these types is expected: `() -> System.out.println("hi")` supplied where a `Runnable` is expected is shorthand for a full anonymous class implementing `run()` with that one line as its body. This is *why* `new Thread(() -> ...)` (Part 1.1) and `pool.submit(() -> ...)` compile at all — the lambda is quietly being turned into an object implementing `Runnable` or `Callable<V>`, matched purely by the shape of its single method, not by any name relationship to the interface.

---
---

# PART 0 — Why Concurrency Exists

## 0.1 Process vs Thread

Think of a **process** as an apartment and **threads** as roommates.

| | Process | Thread |
|---|---|---|
| Memory | Own isolated address space | **Shares** heap/memory with sibling threads |
| Creation cost | Expensive (~ms) | Cheaper (~µs), but still ~1MB stack each |
| Communication | IPC: sockets, pipes, shared memory (slow, explicit) | Just read/write the same object (fast, *dangerously* implicit) |
| Crash blast radius | One process dies, others fine | One thread corrupts shared state → whole process is suspect |
| Java | One JVM = one process | `Thread` objects inside that JVM |

**The whole difficulty of multithreading comes from one line in that table:** threads share memory. That sharing is what makes them fast, and it is also what makes them wrong.

Concretely, per Part F1: every thread gets its **own** call stack and its own snapshot of CPU registers while it's running — that part is never shared, which is why local variables are always safe. What *is* shared is the **heap** — every object created with `new` lives in one common pool that every thread in the process can reach a reference to. "Threads share memory" really means "threads share the heap, not the stack," and nearly every bug in this entire guide is a consequence of two threads reaching the same heap object through two different references at the same time.

The ~1MB-per-thread cost in the table is Part F1's reserved call-stack space, paid whether or not the thread ever recurses deeply enough to use most of it — it's reserved virtual address space up front, which is why thousands of platform threads add up to gigabytes fast (Part 9.1), and why virtual threads (Part 14) that keep their stack as a small, growable heap object sidestep this cost entirely.

## 0.2 Concurrency vs Parallelism

- **Concurrency** = *dealing with* many things at once (structure). One barista taking 5 orders, switching between them.
- **Parallelism** = *doing* many things at once (execution). Five baristas.

You can have concurrency on 1 CPU core (via time-slicing). You need ≥2 cores for parallelism.

```
Concurrency (1 core):  A--  B--  A--  C--  B--  A--   (interleaved)
Parallelism (3 cores): A------------
                       B------------
                       C------------
```

The "interleaved" diagram is literally the OS scheduler from Part F5 performing rapid context switches between A, B, and C on a single core — each dash is a slice of time the scheduler granted that thread before preempting it for the next one. Nothing about the *code* changes between the concurrent and parallel cases; the difference is purely how many cores the OS has available to actually run threads on simultaneously versus how many it has to time-slice between.

**Why you care:** This determines your thread pool size. See Part 9.5.

## 0.3 The Two Reasons to Use Threads

### Reason 1: Throughput on CPU-bound work

You have 8 cores. A single-threaded program uses 1/8 = 12.5% of your machine. Splitting work across 8 threads can give ~8x.

```java
// Sum 100 million numbers. Single-threaded: ~400ms. 8 threads: ~60ms.
long sum = LongStream.rangeClosed(1, 100_000_000).parallel().sum();
```

### Reason 2: Latency hiding on I/O-bound work

This is the **far more common reason in industry.** Your API call to the payment gateway takes 200ms. During those 200ms your CPU does *nothing*. It's waiting on the network.

```
Sequential:   [DB 50ms][Payment 200ms][Email 100ms]  = 350ms
Concurrent:   [DB 50ms]
              [Payment 200ms]                          = 200ms
              [Email 100ms]
```

**Real example:** A product page on an e-commerce site needs: product details, price, inventory, reviews, recommendations, and user's cart badge — 6 microservice calls at ~80ms each. Sequential = 480ms (users bounce). Parallel = ~90ms.

> ❓ **"Why can't I just make my code faster instead?"**
> You can't make the network faster. A 200ms round-trip to a payment gateway in another datacenter is physics + their processing time. The only way to reduce total wall-clock time is to overlap the waiting.

The distinction between these two reasons matters because they call for different tools, a theme this whole guide returns to. Reason 1 is bottlenecked on CPU cycles, so you want roughly one thread per core (Part 9.5's CPU-bound formula) — more threads than that just adds context-switch overhead (Part F5) without adding compute capacity. Reason 2 is bottlenecked on *waiting*, not compute — while a thread is blocked on the network, its core sits idle and could easily be running other threads' work, which is exactly why I/O-bound workloads can profitably run *far* more threads than you have cores (Part 9.5's I/O-bound formula), and why Part 14's virtual threads — which are specifically about making blocking cheap — target this second reason almost exclusively.

## 0.4 Amdahl's Law — The Reality Check

> Speedup is limited by the fraction of your program that **must** be serial.

$$\text{Speedup} \le \frac{1}{S + \frac{1-S}{N}}$$

where `S` = serial fraction, `N` = number of cores.

If 10% of your program is serial (e.g., a `synchronized` block everyone contends on), then even with **infinite** cores your max speedup is **10x**. With 5% serial, max is 20x.

Where does this formula actually come from? If a fraction `S` of the total work must run one step at a time no matter what, and the remaining `1 - S` can be perfectly split across `N` cores, then total time with `N` cores is `S + (1-S)/N` (in units where the original single-threaded time is 1). Speedup is the original time divided by this new time, i.e. `1 / (S + (1-S)/N)`. As `N` grows toward infinity, the `(1-S)/N` term shrinks toward zero, and the whole expression converges on `1/S` — a hard ceiling set entirely by the serial fraction, no matter how much parallel hardware you throw at it. This is precisely why lock contention is so disproportionately damaging: a `synchronized` block that 10% of requests must wait behind isn't just "a bit of overhead," it's a mathematical cap on how much this system can ever benefit from more cores.

**Industry implication:** Adding more threads to a system with a hot lock does nothing — or makes things worse (more context switching, more contention). This is why *lock-free* and *lock-striping* designs (Part 7, Part 8) exist.

## 0.5 The Costs You're Paying

Threads are not free. Before adding threads, know the bill:

| Cost | Magnitude | Notes |
|---|---|---|
| Thread creation | ~50–100 µs, ~1 MB stack (reserved virtual) | Why we use **pools** (Part 9) |
| Context switch | ~1–10 µs + cache pollution | OS saves/restores registers; your CPU caches go cold |
| Lock contention | Can be 100x+ slower than uncontended | Uncontended lock ≈ 20ns; contended = park/unpark syscall |
| Memory synchronization | Cache line invalidation across cores | See false sharing, Part 15 |
| **Developer time** | The biggest cost | Concurrency bugs are non-deterministic and brutal to debug |

Every row of this table now has a mechanical explanation from Part F: thread creation costs microseconds because the OS has to reserve stack space and register the thread with its scheduler (F1, F5); a context switch costs microseconds *plus* subsequent cache misses because the incoming thread's data almost certainly isn't in this core's cache anymore (F2); lock contention is expensive specifically when it escalates from a mark-word CAS to a real OS park/unpark (F6, F5); and memory synchronization cost is the cache-coherence traffic from F2 made visible in a profiler.

> 🎯 **The SDE-2 mindset:** The best concurrent code is the code you didn't write. Prefer: no shared state → immutable shared state → concurrent collections → explicit locks. In that order.

---
---

# PART 1 — Threads: Creation, Lifecycle, and Control

## 1.1 Four Ways to Create a Thread

### Way 1: Extend `Thread` (❌ rarely correct)

```java
class ReportGenerator extends Thread {
    @Override
    public void run() {
        System.out.println("Generating report on " + Thread.currentThread().getName());
    }
}

new ReportGenerator().start();
```

**Why it's bad:** Java has single inheritance. You just burned your one `extends` slot on a threading detail. Also you've coupled *what the work is* to *how it runs*. Now you can't submit it to a thread pool.

### Way 2: Implement `Runnable` (✅ good)

```java
class ReportGenerator implements Runnable {
    private final String reportId;
    ReportGenerator(String reportId) { this.reportId = reportId; }

    @Override
    public void run() {
        System.out.println("Generating " + reportId);
    }
}

new Thread(new ReportGenerator("Q3-Sales")).start();
// Or hand the SAME object to a pool — decoupled from execution:
executorService.submit(new ReportGenerator("Q4-Sales"));
```

**`Runnable` separates the task from the execution policy.** That's the entire design insight behind the Executor framework.

### Way 3: Lambda (✅ what you'll actually write)

```java
new Thread(() -> System.out.println("Hello from " + Thread.currentThread().getName())).start();
```

`Runnable` is a functional interface (`void run()`), so a lambda works — see Part F8 if that sentence didn't fully parse; the short version is that a functional interface has exactly one method to implement, so `() -> ...` can stand in as a compact implementation of it.

### Way 4: `Callable<V>` — when you need a *result* or want to throw checked exceptions (✅)

```java
Callable<BigDecimal> priceTask = () -> {
    return priceService.fetchPrice("SKU-123");   // may throw IOException — allowed!
};

ExecutorService pool = Executors.newFixedThreadPool(4);
Future<BigDecimal> future = pool.submit(priceTask);
BigDecimal price = future.get();   // blocks until done
```

| | `Runnable` | `Callable<V>` |
|---|---|---|
| Return value | ❌ `void` | ✅ `V` |
| Checked exceptions | ❌ can't throw | ✅ can throw |
| Usable with | `Thread`, `Executor` | `ExecutorService` only |

> ❓ **"Why not just use `Runnable` and store the result in a field?"**
> You could — but then *you* have to solve: (a) how does the caller know it's done? (b) how does the value get safely published across threads (Part 2)? (c) what if it threw an exception? `Callable` + `Future` solves all three. Don't rebuild it.

### ⚠️ `start()` vs `run()` — the classic interview trap

```java
Thread t = new Thread(() -> System.out.println(Thread.currentThread().getName()));

t.run();    // prints "main"      ← just a normal method call! NO new thread.
t.start();  // prints "Thread-0"  ← asks the JVM/OS to create a new thread
```

`start()` can be called **only once**. Calling it twice throws `IllegalThreadStateException`.

`t.run()` prints `"main"` because, viewed from the compiler's and CPU's perspective, `run()` is nothing special — it's just a method being called on the current call stack (Part F1), executed by whichever thread happened to make the call, exactly like calling any other method. `t.start()`, by contrast, is a native method that reaches down into the OS (a syscall, Part F5) to actually create a new OS-level thread — a new call stack, a new entry on the scheduler's runnable queue — and *that* new thread is the one that eventually calls `run()` on your behalf. This is why `start()` can only happen once: it's a one-time act of OS thread creation, not a re-runnable method call.

## 1.2 Thread Lifecycle (The 6 States)

`Thread.State` enum — memorize this, it's asked constantly and it's what you read in thread dumps.

```
                    start()
     NEW ──────────────────────────► RUNNABLE ◄──────────────┐
                                    │  │  │                  │
                                    │  │  │ synchronized     │ lock acquired
                                    │  │  └──────────► BLOCKED
                                    │  │
                                    │  │ wait() / join() / park()
                                    │  └────────────► WAITING
                                    │                    │ notify()/notifyAll()/
                                    │                    │ target dies/unpark()
                                    │  sleep(t)/wait(t)  │
                                    │  join(t)           │
                                    └──────────► TIMED_WAITING
                                    
     run() returns or throws
     ──────────────────────► TERMINATED
```

| State | Meaning | How you get here |
|---|---|---|
| `NEW` | Object created, `start()` not called | `new Thread(...)` |
| `RUNNABLE` | Running **or** ready and waiting for CPU | `start()`. (Java doesn't distinguish "running" from "ready") |
| `BLOCKED` | Waiting to acquire an **intrinsic lock** (`synchronized`) | Hit a `synchronized` block someone else holds |
| `WAITING` | Waiting indefinitely for another thread | `wait()`, `join()`, `LockSupport.park()` |
| `TIMED_WAITING` | Waiting with a deadline | `sleep(n)`, `wait(n)`, `join(n)`, `awaitTermination(n)` |
| `TERMINATED` | `run()` finished (normally or via exception) | — |

Notice that `RUNNABLE` covers two genuinely different situations the JVM doesn't distinguish: a thread the scheduler (Part F5) has actually put on a core right now, and a thread that's fully ready to run but sitting in the scheduler's queue waiting its turn. Both look identical from `Thread.getState()` — Java's model only cares whether the *JVM* is blocking you (the states below), not whether the *OS* happens to be giving you a core this microsecond.

> 🔍 **Real debugging use:** When your service hangs, take a thread dump (`jstack <pid>`). Lots of threads in `BLOCKED` on the same lock → lock contention. Lots in `WAITING` on a connection pool → pool exhaustion. This maps directly to Part 16.

> ⚠️ **`BLOCKED` vs `WAITING` — trap:** `BLOCKED` is *only* for `synchronized` monitor entry. A thread waiting on `ReentrantLock.lock()` shows as `WAITING` (it uses `LockSupport.park()`), not `BLOCKED`. Surprises people reading dumps.

This split exists because `synchronized` (Part 3) and `ReentrantLock` (Part 6) are implemented at genuinely different layers. `BLOCKED` reflects the JVM's own built-in monitor mechanism (the object header's mark word, Part F6) — the JVM itself knows a thread is queued for a specific monitor, so it can report that precisely. `ReentrantLock` is ordinary Java code built on `LockSupport.park()` (Part F5, Part 6.6) — as far as the JVM's thread-state bookkeeping is concerned, that's indistinguishable from any other reason a thread might be parked, so it's lumped into the more generic `WAITING` bucket.

## 1.3 `sleep()` vs `wait()` — Top-5 Interview Question

```java
synchronized (lock) {
    Thread.sleep(1000);   // ⛔ STILL HOLDS THE LOCK for 1 second
}

synchronized (lock) {
    lock.wait(1000);      // ✅ RELEASES the lock, reacquires before returning
}
```

| | `Thread.sleep(ms)` | `object.wait()` |
|---|---|---|
| Class | `Thread` (static) | `Object` (instance) |
| Releases lock? | **No** | **Yes** (only the lock on that object) |
| Needs to be in `synchronized`? | No | **Yes**, else `IllegalMonitorStateException` |
| Wakes on | Timer expiry | `notify()`, `notifyAll()`, timeout, spurious wakeup |
| Purpose | Pause/throttle | **Coordinate** between threads |

**Industry use case for `sleep`:** backoff between retries.

```java
// Exponential backoff with jitter — standard for calling flaky external APIs
int attempt = 0;
while (true) {
    try {
        return httpClient.call(request);
    } catch (TransientException e) {
        if (++attempt > 5) throw e;
        long backoffMs = (long) (Math.pow(2, attempt) * 100);
        long jitter = ThreadLocalRandom.current().nextLong(backoffMs / 2);
        Thread.sleep(backoffMs + jitter);   // jitter prevents thundering herd
    }
}
```

> ❓ **"Why jitter?"** If 1000 clients all fail at the same moment and all retry after exactly 200ms, you get a synchronized stampede that re-kills the recovering service. Randomizing spreads the load. AWS's "Exponential Backoff and Jitter" blog post is the canonical reference.

> ⚠️ **`Thread.sleep(0)`** is not a no-op — it's a hint to the scheduler to yield. Don't rely on it. Use `Thread.onSpinWait()` (Java 9+) in spin loops instead.

## 1.4 `join()` — Wait For a Thread to Finish

```java
Thread inventoryCheck = new Thread(() -> inventory.reserve(orderId));
Thread fraudCheck     = new Thread(() -> fraud.evaluate(orderId));

inventoryCheck.start();
fraudCheck.start();

inventoryCheck.join();   // main thread WAITS here until inventoryCheck dies
fraudCheck.join();

System.out.println("Both checks done, proceed to payment");
```

`join()` is the "fork-join" of raw threads. In practice you'd use `invokeAll` or `CompletableFuture.allOf` (Parts 9, 10) — but `join()` is what they're built on conceptually.

`t.join(5000)` waits at most 5s. **It does not tell you whether the thread finished** — you must check `t.isAlive()` afterward. Common bug.

## 1.5 Daemon Threads

```java
Thread metricsReporter = new Thread(this::publishMetricsForever);
metricsReporter.setDaemon(true);   // MUST be set BEFORE start()
metricsReporter.start();
```

**The JVM exits when all *non-daemon* threads finish.** Daemon threads are killed abruptly at that point — no `finally` blocks, no cleanup.

| Use daemon for | Don't use daemon for |
|---|---|
| Metrics/heartbeat publishers | Anything writing to a DB or file |
| Cache eviction sweepers | In-flight request handling |
| JVM housekeeping (GC threads are daemons) | Anything whose partial completion corrupts state |

> ⚠️ **Real production incident pattern:** Someone marks the "flush buffered events to disk" thread as daemon. On shutdown, JVM exits, buffer is lost, and you silently drop the last N seconds of analytics data — forever. Use a **shutdown hook** or graceful `ExecutorService` shutdown (Part 9.7) instead.

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    log.info("Flushing buffers before exit...");
    eventBuffer.flushAll();
}));
```

## 1.6 Interruption — The *Only* Correct Way to Stop a Thread

`Thread.stop()` is deprecated and **dangerous**: it throws `ThreadDeath` at an arbitrary bytecode instruction (Part F4) — literally any of the `getfield`/`iadd`/`putfield`-style steps mid-operation — potentially mid-way through updating a data structure, while holding locks — leaving your object graph corrupted with the locks *released*. Never use it.

**Interruption is cooperative.** It sets a flag. The thread decides how to respond.

```java
public class OrderPoller implements Runnable {
    @Override
    public void run() {
        try {
            while (!Thread.currentThread().isInterrupted()) {   // check the flag
                Order o = queue.take();                          // throws InterruptedException
                process(o);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();   // ✅ RESTORE the flag
        } finally {
            cleanup();                            // ✅ always runs
        }
    }
}
```

### The Three Rules of `InterruptedException`

**Rule 1 — NEVER swallow it.**

```java
// ⛔ THE #1 CONCURRENCY SIN IN JAVA CODEBASES
try { Thread.sleep(1000); }
catch (InterruptedException e) { /* ignored */ }
```
This makes your thread **un-cancellable**. Your service now takes 30s to shut down and gets `SIGKILL`ed by Kubernetes, dropping in-flight requests.

**Rule 2 — Either propagate it, or restore the flag.**

```java
// Option A: propagate (preferred if your method can declare it)
void fetchData() throws InterruptedException {
    Thread.sleep(100);
}

// Option B: restore the flag (when you can't change the signature, e.g. Runnable.run())
try { Thread.sleep(100); }
catch (InterruptedException e) {
    Thread.currentThread().interrupt();   // let callers up the stack see it
    return;                                // and stop doing work
}
```

**Rule 3 — Catching `InterruptedException` clears the flag.** That's *why* you must restore it. If you don't, code higher up the stack has no idea cancellation was requested.

### Interruption Cheat Sheet

| Method | Effect |
|---|---|
| `t.interrupt()` | Sets t's interrupt flag. If t is in `sleep`/`wait`/`join`/`take`, throws `InterruptedException` **and clears the flag** |
| `t.isInterrupted()` | Reads the flag. **Does not clear it** |
| `Thread.interrupted()` | Reads **current** thread's flag **and clears it** (static) |

The interrupt flag itself is just a single bit stored on the `Thread` object — `interrupt()` sets it, nothing more, by default. The *throwing* behavior only happens because methods like `sleep`, `wait`, `join`, and `BlockingQueue.take()` are specifically written to check that bit (or be woken by the OS via the syscall machinery in Part F5) and translate "someone set my interrupt flag" into a thrown `InterruptedException` on your behalf, clearing the flag as they do — which is exactly why, after catching one, the flag is already gone and you must manually set it back if you want code further up the call stack to still be able to observe that cancellation was requested.

> ⚠️ **Blocking I/O is NOT interruptible.** `interrupt()` will *not* wake a thread stuck in `InputStream.read()` on a socket. To cancel those, close the socket (which throws `SocketException`), or use `InterruptibleChannel` (NIO). This is a classic production hang.

**Industry use case — graceful shutdown of a Kafka consumer:**

```java
public class ConsumerRunner implements Runnable {
    private final KafkaConsumer<String, String> consumer;
    private volatile boolean running = true;   // volatile — see Part 2!

    public void run() {
        try {
            while (running && !Thread.currentThread().isInterrupted()) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
                records.forEach(this::handle);
                consumer.commitSync();
            }
        } catch (WakeupException e) {
            if (running) throw e;    // unexpected wakeup
        } finally {
            consumer.commitSync();   // commit offsets before dying — no reprocessing
            consumer.close();
        }
    }

    public void shutdown() {
        running = false;
        consumer.wakeup();   // Kafka's way to interrupt a blocking poll()
    }
}
```

## 1.7 Uncaught Exceptions in Threads

An exception thrown from `run()` **kills only that thread**, silently. The main thread never knows.

```java
new Thread(() -> { throw new RuntimeException("boom"); }).start();
// main continues happily. Stack trace goes to stderr, easily lost in logs.
```

Always install a handler:

```java
// Per-thread
t.setUncaughtExceptionHandler((thread, ex) ->
    log.error("Thread {} died", thread.getName(), ex));

// Global default (do this in every service's main())
Thread.setDefaultUncaughtExceptionHandler((thread, ex) -> {
    log.error("FATAL uncaught in {}", thread.getName(), ex);
    metrics.counter("thread.uncaught").increment();
});
```

> ⚠️ **Executor gotcha:** With `executor.submit(task)`, exceptions are **captured into the `Future`** and the `UncaughtExceptionHandler` is *not* called. If you never call `future.get()`, the exception vanishes completely. With `executor.execute(task)`, the handler *is* called. This silently-swallowed-exception bug is extremely common — see Part 9.9.

## 1.8 Thread Naming and Priority

**Always name your threads.** Non-negotiable for production debugging.

```java
ThreadFactory namedFactory = r -> {
    Thread t = new Thread(r, "order-processor-" + counter.incrementAndGet());
    t.setDaemon(false);
    t.setUncaughtExceptionHandler(handler);
    return t;
};
ExecutorService pool = Executors.newFixedThreadPool(8, namedFactory);
```

Without this, your thread dump says `pool-3-thread-7` and you have no idea which of your 12 pools it belongs to.

**Priority (`Thread.setPriority(1..10)`): ignore it.** It's a *hint* mapped inconsistently across OSes — on Linux it's often ignored entirely without root privileges. Never build correctness or performance on it.

---
---

# PART 2 — The Java Memory Model (JMM)

> **If you only deeply understand one part of this document, make it this one.** Every weird "it works on my laptop but fails in prod" concurrency bug traces back here.

## 2.1 The Three Problems

Shared mutable state has exactly three failure modes:

| Problem | Question it answers | Fixed by |
|---|---|---|
| **Atomicity** | Can my operation be interrupted halfway? | `synchronized`, `Lock`, atomics |
| **Visibility** | Will other threads *ever* see my write? | `volatile`, `synchronized`, `final`, atomics |
| **Ordering** | Will operations execute in the order I wrote them? | `volatile`, `synchronized` (happens-before) |

Most people only know about atomicity. **Visibility bugs are far nastier** because the code looks perfectly correct.

It's worth being explicit about *why* Java needs a formal "memory model" at all, rather than just "do what the code says." Part F2 and F4 already gave you the two root causes: modern CPUs each keep their own local cache of memory (so a write doesn't necessarily become visible to another core immediately), and the JIT compiler is legally allowed to reorder or eliminate operations that don't affect single-threaded correctness (because that's the only correctness the language originally promised). The **Java Memory Model** is the JLS's specification of exactly which reorderings and delays are legal and which memory-visibility guarantees you get in return for using `volatile`, `synchronized`, and friends — it exists precisely to draw a hard line between "your program has zero guarantees here" and "your program is guaranteed to behave a specific way," so both hardware vendors and JIT authors have a precise contract to implement against, and so you have a precise contract to code against.

## 2.2 Problem 1 — Atomicity (Race Conditions)

```java
class Counter {
    private int count = 0;
    public void increment() { count++; }   // ⛔ NOT atomic
}
```

`count++` is actually **three** bytecode operations (Part F4 — this is genuine JVM bytecode, not a simplification):

```
1. READ  count from memory into a register    (getfield)
2. ADD   1 to the register                    (iadd)
3. WRITE the register back to memory          (putfield)
```

Two threads interleaving:

| Time | Thread A | Thread B | count |
|---|---|---|---|
| t1 | read count → 5 | | 5 |
| t2 | | read count → 5 | 5 |
| t3 | compute 5+1=6 | | 5 |
| t4 | | compute 5+1=6 | 5 |
| t5 | write 6 | | 6 |
| t6 | | write 6 | **6** ← lost update! |

Two increments, one result. This is a **read-modify-write race**.

**Demonstration:**

```java
public class LostUpdateDemo {
    static int count = 0;
    public static void main(String[] args) throws Exception {
        Runnable task = () -> { for (int i = 0; i < 100_000; i++) count++; };
        Thread t1 = new Thread(task), t2 = new Thread(task);
        t1.start(); t2.start(); t1.join(); t2.join();
        System.out.println(count);   // Expected 200000. Actual: ~137842, ~189001, random.
    }
}
```

### The other race: check-then-act

```java
// ⛔ Classic lazy-init race
public Connection getConnection() {
    if (conn == null) {          // CHECK
        conn = createConnection(); // ACT
    }
    return conn;
}
```
Two threads both see `null`, both create a connection. Now you have a leaked connection, and two threads holding different objects that were supposed to be one.

**Real production version:** "Check if username exists, then insert." Two concurrent signups with the same email → two rows. Fix at the *database* level with a UNIQUE constraint — application-level locks don't work across multiple server instances. **This is a key SDE-2 insight: in a distributed system, a JVM lock only protects one JVM.**

## 2.3 Problem 2 — Visibility (The Invisible Killer)

```java
public class StopFlagBug {
    private static boolean stopped = false;   // ⛔ not volatile

    public static void main(String[] args) throws Exception {
        new Thread(() -> {
            int i = 0;
            while (!stopped) { i++; }        // may loop FOREVER
            System.out.println("Stopped after " + i);
        }).start();

        Thread.sleep(1000);
        stopped = true;                       // main writes true
        System.out.println("Set stopped=true");
    }
}
```

**Run this with `-server` (default) and it very often never terminates.** The worker thread never sees `stopped = true`.

### Why? Three culprits

**1. CPU caches.** Each core has its own L1/L2 cache (Part F2). Thread A writes `stopped=true` into *its* core's cache. Thread B reads from *its* core's cache. Without a memory barrier (Part F3), there's no guarantee the value ever propagates before B looks again.

```
   Core 1                Core 2
  ┌──────┐              ┌──────┐
  │ L1   │              │ L1   │
  │stopped=true│        │stopped=false│  ← reads stale value
  └──┬───┘              └───┬──┘
     └───────► RAM ◄────────┘
```

**2. JIT hoisting.** The JIT compiler (Part F4) sees `stopped` is never modified inside the loop *as far as it can tell from this thread's own execution* and legally rewrites:

```java
// What you wrote:              // What JIT compiles:
while (!stopped) { i++; }       if (!stopped) { while(true) { i++; } }
```
This is a **legal** optimization for single-threaded semantics. The JMM permits it because you didn't tell the compiler this field is shared — nothing in the bytecode for a plain field distinguishes "only I ever touch this" from "another thread might change this at any moment," so the compiler defaults to assuming the more optimizable case.

**3. Register allocation.** The variable may live entirely in a CPU register (Part F1) for the duration of the loop, never touching memory at all after the first read — the fastest possible place to keep a value you're re-reading constantly, and, absent a `volatile` marker telling the compiler otherwise, a perfectly legal choice.

### The Fix: `volatile`

```java
private static volatile boolean stopped = false;   // ✅ terminates in ~1s
```

## 2.4 `volatile` — What It Guarantees (and What It Doesn't)

### ✅ `volatile` GUARANTEES

1. **Visibility** — a write is immediately flushed to main memory; a read always comes from main memory. Never a stale value. Mechanically, this is Part F3's store/release and load/acquire barriers: the compiler is forbidden from keeping a `volatile` field in a register across iterations (culprit 3, defeated), forbidden from reordering the write past the barrier (culprit 2, defeated), and the barrier itself forces the cache-coherence hardware from Part F2 to actually propagate the new value rather than let it sit in one core's local cache (culprit 1, defeated). All three of the visibility culprits from 2.3 are addressed by the same one keyword because all three culprits are really different symptoms of the same root cause: nothing told the compiler or hardware this field was shared.
2. **Ordering (happens-before)** — everything written *before* a volatile write is visible to a thread that reads that volatile afterwards. This is huge; see 2.6.
3. **Atomicity for `long`/`double`** — without `volatile`, 64-bit reads/writes on a 32-bit JVM may be split into two 32-bit halves, producing a "word-tearing" value that was never written. `volatile` (or `final`) prevents this.

### ❌ `volatile` DOES NOT GUARANTEE

**Atomicity of compound operations.**

```java
private volatile int count = 0;
public void increment() { count++; }   // ⛔ STILL BROKEN
```

`volatile` makes each *read* and each *write* atomic and visible. But `count++` is read-then-write — another thread can still slip between them. This is exactly Part F7's distinction: `volatile` guarantees each individual memory access is atomic and visible, but says nothing at all about a *sequence* of accesses being indivisible as a unit — the CAS instruction from Part F7/Part 7.2 is what actually closes that gap, by making the whole read-compare-write sequence atomic in hardware.

> 🎯 **The rule:** `volatile` is correct only when the new value **does not depend on the old value**, and only one thread writes (or writes are independent).

| Use case | `volatile` OK? |
|---|---|
| `boolean shutdownRequested = true` (flag) | ✅ Yes |
| `config = newConfigObject` (reference swap) | ✅ Yes |
| `count++` | ❌ No — use `AtomicInteger` |
| `if (x == null) x = new Foo()` | ❌ No — use lock or `AtomicReference.compareAndSet` |
| `balance = balance - amount` | ❌ No — use lock |

### Industry use cases for `volatile`

```java
// 1. Shutdown flag for a long-running worker
private volatile boolean running = true;

// 2. Hot-reloadable config (immutable object swapped atomically)
private volatile FeatureFlags flags = FeatureFlags.defaults();
public void onConfigUpdate(FeatureFlags newFlags) { this.flags = newFlags; }
// Readers get either the old complete object or the new complete object — never a mix.
// This works ONLY because FeatureFlags is immutable. See Part 13.

// 3. Circuit breaker state
private volatile State state = State.CLOSED;   // CLOSED / OPEN / HALF_OPEN

// 4. Double-checked locking (see 2.8)
private volatile Singleton instance;
```

> ❓ **"Why is `volatile` cheaper than `synchronized`?"**
> `volatile` inserts CPU memory barriers (Part F3) but never blocks a thread, never parks/unparks (Part F5), never involves the OS scheduler. A volatile read on x86 is basically free (a plain load); a volatile write costs ~a few ns (a store fence). `synchronized` under contention can cost microseconds because it escalates all the way to a syscall (Part F5, Part F6's lock inflation). So: use `volatile` when you only need visibility, not mutual exclusion.

## 2.5 Problem 3 — Instruction Reordering

The compiler, the JIT, and the CPU **all** reorder instructions for speed — the compiler and JIT for the reasons in Part F4 (better use of registers, fewer redundant memory accesses), the CPU itself for reasons of its own (modern CPUs execute instructions out of order internally and only *retire* results in a way that preserves single-threaded appearances). Legal as long as *single-threaded* behavior is preserved. Multi-threaded observers see the chaos, because nothing in that guarantee says anything about what a *different* thread, watching from the outside, is allowed to observe.

```java
class ReorderingDemo {
    int a = 0, b = 0;
    int x = 0, y = 0;

    // Thread 1        // Thread 2
    a = 1;             b = 1;
    x = b;             y = a;
}
```
You'd expect `x` and `y` can be (0,1), (1,0), or (1,1). But **(0,0) is legal and does happen**, because each thread's two independent statements can be reordered — from Thread 1's own point of view, `a=1` and `x=b` don't depend on each other's order, so a compiler or CPU is free to execute `x=b` before `a=1`, and Thread 2's `y=a` before `b=1`, and no single-threaded test would ever catch it.

This is exactly what breaks naive singletons (2.8).

## 2.6 Happens-Before — The Rule That Governs Everything

> **Definition:** If action A *happens-before* action B, then A's memory effects are guaranteed visible to B.

If there is **no** happens-before relationship between two actions, **the JMM gives you zero guarantees** — it may work in testing and fail under load, on a different CPU, or after JIT warms up. This isn't the JMM being unhelpfully vague; it's the JMM being honest about the fact that, absent a barrier (Part F3) telling the hardware and compiler otherwise, there is genuinely no mechanism enforcing any particular order or visibility at all.

### The happens-before rules (memorize these)

| # | Rule | Meaning |
|---|---|---|
| 1 | **Program order** | Within a single thread, earlier statements happen-before later ones |
| 2 | **Monitor lock** | `unlock` on monitor M happens-before every subsequent `lock` on M |
| 3 | **Volatile** | A write to volatile `v` happens-before every subsequent read of `v` |
| 4 | **Thread start** | `t.start()` happens-before everything inside `t` |
| 5 | **Thread join** | Everything in `t` happens-before `t.join()` returns |
| 6 | **Interruption** | `t.interrupt()` happens-before `t` detects the interrupt |
| 7 | **Finalizer** | Constructor end happens-before `finalize()` |
| 8 | **Transitivity** | A hb B, B hb C ⟹ A hb C |

Every one of rules 2–6 corresponds to a specific memory barrier (Part F3) the JVM inserts at that exact point — rule 2 is the release barrier on unlock paired with the acquire barrier on lock (Part F6's monitor mechanics); rule 3 is the volatile store/load barrier pair from 2.4; rules 4–6 are barriers the JVM inserts around thread lifecycle operations specifically so that "I started a thread" or "I finished waiting for one" carries a concrete, enforceable visibility guarantee rather than a hopeful one.

**Rule 8 (transitivity) is the powerful one.** It's why this works:

```java
class Publisher {
    private int[] data;                    // NOT volatile
    private volatile boolean ready = false; // volatile

    // Thread A
    void publish() {
        data = computeExpensiveArray();     // (1) normal write
        ready = true;                       // (2) volatile write
    }

    // Thread B
    void consume() {
        if (ready) {                        // (3) volatile read
            use(data);                      // (4) SAFE — sees the fully-built array
        }
    }
}
```
(1) hb (2) [program order] → (2) hb (3) [volatile] → (3) hb (4) [program order] ⟹ **(1) hb (4)**.

The volatile write acts as a "release fence" (Part F3) — it flushes *everything* written before it, not merely the `ready` field itself. This is called the **piggyback** pattern and it's how many high-performance libraries work: one cheap volatile write at the end of a batch of ordinary writes safely publishes the whole batch, without needing every individual field to be volatile.

> ⚠️ But if `ready` were **not** volatile, thread B could see `ready == true` while `data` is still `null` or half-constructed. This is the single most common "impossible" NPE in concurrent Java.

## 2.7 Final Fields — The Free Guarantee

```java
public final class ImmutablePoint {
    private final int x, y;
    public ImmutablePoint(int x, int y) { this.x = x; this.y = y; }
    public int getX() { return x; }
}
```

The JMM makes a **special promise for `final` fields**: if an object is properly constructed (the `this` reference doesn't escape the constructor), any thread that sees the reference is guaranteed to see the correctly-initialized `final` fields — **with no synchronization at all**. Concretely, the JVM inserts an implicit release-style barrier (Part F3) at the *end* of any constructor that assigns a `final` field, ensuring those writes are flushed before the constructor returns and the new reference can possibly leak out to another thread — you never see this barrier in your source code because the language specification puts it there for you automatically, precisely because `final` fields are common and important enough to deserve a built-in guarantee.

This is why immutable objects are automatically thread-safe, and why `String`, `Integer`, `LocalDate`, and `BigDecimal` can be shared freely.

> ⚠️ **"`this` escaping the constructor"** breaks this guarantee:
> ```java
> public class Listener {
>     private final int id;
>     public Listener(EventBus bus) {
>         bus.register(this);   // ⛔ `this` escapes BEFORE `id` is assigned!
>         this.id = 42;         // another thread may see id == 0
>     }
> }
> ```
> **Fix:** use a static factory — construct fully, *then* register.

Why does escaping break it specifically? The JMM's final-field guarantee only covers threads that obtain the reference **after** the constructor has finished (that's what the implicit barrier at constructor-end is timed around). If `bus.register(this)` hands the reference to another thread *while the constructor is still running*, that thread received the reference before the barrier ever ran — the guarantee simply doesn't apply to it, and it's free to observe the object exactly as it looked at that moment, `id` field and all.

## 2.8 Case Study: Double-Checked Locking (DCL)

The classic lazy singleton. Watch it break and get fixed.

### ❌ Version 1: Broken (no synchronization)
```java
public static Singleton getInstance() {
    if (instance == null) instance = new Singleton();   // race: two instances
    return instance;
}
```

### ⚠️ Version 2: Correct but slow
```java
public static synchronized Singleton getInstance() {
    if (instance == null) instance = new Singleton();
    return instance;
}
```
Correct, but *every* call acquires the lock forever, even though initialization happens once.

### ❌ Version 3: DCL without `volatile` — SUBTLY BROKEN
```java
private static Singleton instance;   // NOT volatile

public static Singleton getInstance() {
    if (instance == null) {                    // 1st check (no lock)
        synchronized (Singleton.class) {
            if (instance == null)              // 2nd check (with lock)
                instance = new Singleton();
        }
    }
    return instance;
}
```

**Why it's broken.** `instance = new Singleton()` compiles to roughly:
```
1. allocate memory for the object
2. run the constructor (initialize fields)
3. assign the reference to `instance`
```
Steps **2 and 3 can be reordered** (this is legal, per 2.5!) — from this one thread's own single-threaded point of view, nothing depends on the constructor finishing before the reference assignment becomes visible externally, so the JIT (Part F4) is free to rearrange them for efficiency. If thread A does 1 → 3 → 2, then thread B doing the first check sees a **non-null reference to a half-constructed object** and returns it. B then reads uninitialized fields.

### ✅ Version 4: DCL with `volatile` (correct)
```java
private static volatile Singleton instance;   // ✅ volatile prevents the reorder
```
The volatile write forbids reordering steps 2 and 3 past it (Part F3's barrier semantics), and gives readers a happens-before edge (rule 3, 2.6).

### ✅ Version 5: Initialization-on-demand holder (best, no volatile needed)
```java
public class Singleton {
    private Singleton() {}
    private static class Holder {
        static final Singleton INSTANCE = new Singleton();
    }
    public static Singleton getInstance() { return Holder.INSTANCE; }
}
```
The JVM guarantees class initialization is thread-safe and lazy — `Holder` isn't loaded until first `getInstance()`. Zero synchronization cost after the first call. This sidesteps 2.7's `final`-field-guarantee machinery entirely by leaning on a *different* built-in JVM guarantee: the class-loading mechanism itself is specified to run each class's static initializers exactly once, under mutual exclusion, before any thread can observe the results — a guarantee the JVM must provide regardless of concurrency, simply to make class loading itself well-defined.

### ✅ Version 6: Enum singleton (simplest, serialization-safe)
```java
public enum Singleton {
    INSTANCE;
    public void doWork() { }
}
```

> 🎯 **In Spring-based services you rarely write singletons at all** — beans are singletons managed by the container. But this is asked in almost every interview because it exercises the entire JMM.

---
---

# PART 3 — `synchronized` and Intrinsic Locks

## 3.1 The Monitor Model

**Every Java object has an invisible lock attached to it** (a "monitor" / "intrinsic lock"). `synchronized` acquires it. As Part F6 laid out, this isn't a separate object living somewhere else — the lock state is bits inside the object's own header (the mark word), which is exactly why *every* object can be locked with zero extra allocation, and why an uncontended `synchronized` block is cheap (a single CAS on memory you were already touching) while a contended one is expensive (the JVM has to inflate that lightweight mark-word record into a real, OS-backed monitor capable of parking threads).

```java
public class BankAccount {
    private double balance;

    public synchronized void deposit(double amt) { balance += amt; }
    public synchronized void withdraw(double amt) {
        if (balance >= amt) balance -= amt;
    }
    public synchronized double getBalance() { return balance; }   // ← don't forget this one!
}
```

> ⚠️ **Common bug: forgetting to synchronize the *reader*.** If `getBalance()` isn't synchronized, it may return a stale value. Synchronization must be on **both** sides — reads and writes — to establish happens-before. This follows straight from Part 2.6's happens-before rule 2: an unlock on M happens-before the *next* lock on M — but if the reader never locks M at all, there's no happens-before edge connecting it to any writer's unlock, and the reader has exactly the same "might read a stale cached value" exposure as the non-`volatile` flag in Part 2.3.

### What `synchronized` actually gives you (both, always)

1. **Mutual exclusion** — only one thread inside at a time
2. **Memory visibility** — on entry, invalidate cache & re-read; on exit, flush writes

That second guarantee is why `synchronized` fixes visibility bugs too, not just races — mechanically, it's the same acquire/release barrier pair (Part F3) that a `volatile` read/write pair inserts, just triggered by monitor entry and exit instead of by a field access.

## 3.2 What Object Is Being Locked?

This trips up everyone.

```java
class Example {
    // Locks on `this`
    public synchronized void a() { }
    // Equivalent to:
    public void a2() { synchronized (this) { } }

    // Locks on Example.class (the Class object) — a DIFFERENT lock from `this`
    public static synchronized void b() { }
    // Equivalent to:
    public static void b2() { synchronized (Example.class) { } }

    // Locks on an explicit object
    private final Object lock = new Object();
    public void c() { synchronized (lock) { } }
}
```

> ⚠️ **Trap:** `a()` and `b()` do **not** exclude each other. One locks the instance, the other locks the class. Thread 1 in `a()` and Thread 2 in `b()` run simultaneously. If they touch the same static field → race.

As Part F6 spelled out: locking "on an object" always means CAS-ing bits in *that specific object's* header. `this` and `Example.class` are two different objects sitting at two different heap addresses (every loaded class has its own `Class` object, itself just an ordinary heap object like any other), so `a()` and `b()` are manipulating two entirely unrelated mark words. There's no hidden connection between "instance lock" and "class lock" — the JVM doesn't infer one from the other, because it has no reason to; you specify exactly which object's header gets touched by what you write inside (or implied by) the `synchronized` clause.

### Best practice: private final lock objects

```java
// ⛔ Bad — locking on `this` exposes the lock publicly
public synchronized void process() { ... }
// Any external code can do `synchronized(myObject) { Thread.sleep(1_000_000); }`
// and deadlock your class. This actually happened with Vector/Hashtable-era code.

// ✅ Good — the lock is an implementation detail
public class OrderService {
    private final Object lock = new Object();
    public void process() { synchronized (lock) { ... } }
}
```

### ⛔ Never lock on these

```java
synchronized ("literal")     { }  // String literals are interned & shared JVM-wide!
synchronized (Integer.valueOf(1)) { }  // Integer cache -128..127 is shared JVM-wide!
synchronized (Boolean.TRUE)  { }  // shared
// Also: never lock on a non-final field — the reference can change under you:
private Object lock = new Object();     // ⛔ should be `final`
```

Each of these is the same underlying mistake: you think you're getting a private, dedicated lock object, but you're actually pointing at an object the *entire JVM* shares — a string literal is interned into one canonical instance process-wide, `Integer.valueOf(1)` returns a cached shared instance (Chunk 16 of the companion collections guide covers the Integer cache in depth if you want the full mechanics), and `Boolean.TRUE` is a single constant. Locking on any of them means your "private" critical section is secretly contending with unrelated code anywhere else in the process that happens to lock the same shared object — a foreign library, a completely different part of your own codebase — with no way to even discover the connection by reading your own class.

## 3.3 Reentrancy

Java's intrinsic locks are **reentrant** — a thread that holds a lock can acquire it again.

```java
public class Widget {
    public synchronized void doSomething() { ... }
}
public class LoggingWidget extends Widget {
    @Override
    public synchronized void doSomething() {
        log.info("calling doSomething");
        super.doSomething();   // ✅ Works — same thread, same lock (on `this`)
    }
}
```

Without reentrancy this would **self-deadlock** instantly. (Pthreads mutexes are non-reentrant by default — this is why C code has more of these bugs.)

Internally the JVM keeps `(owningThread, holdCount)` — this is extra bookkeeping layered on top of the mark word's basic "locked, by whom" state (Part F6). Each acquire increments, each exit decrements; released at zero. This is why reentrancy is essentially free: it's not a separate mechanism, just one more field the JVM already needed to track "is this the same thread that already owns this lock" (to answer "should I block, or is this a nested re-entry").

## 3.4 Lock Granularity — Critical for Performance

```java
// ⛔ Coarse: entire method locked, including the SLOW network call
public synchronized void processOrder(Order o) {
    validate(o);                    // 1 µs
    Response r = paymentApi.charge(o);   // 200 ms ← lock held the whole time!!
    orders.put(o.getId(), o);       // 1 µs
}
```
Throughput ceiling: **5 orders/second**, no matter how many threads or cores. (Amdahl's Law, Part 0.4, made concrete: while one thread holds this lock across a 200ms network call, every other thread wanting the same lock is fully serial — that 200ms is, functionally, the serial fraction `S` for this operation.)

```java
// ✅ Fine-grained: lock only the shared-state mutation
public void processOrder(Order o) {
    validate(o);                             // no shared state — no lock
    Response r = paymentApi.charge(o);       // I/O — NEVER hold a lock across I/O
    synchronized (lock) {
        orders.put(o.getId(), o);            // only this needs protection
    }
}
```

> 🎯 **The rule every SDE-2 must internalize: NEVER perform I/O, call unknown/external code, or sleep while holding a lock.** Calling code you don't control (a callback, a listener, an override) while holding a lock is called an "alien method call" and is the #1 source of unexpected deadlocks.

### Lock striping — when one lock isn't enough

```java
// Instead of one lock for a whole map, use N locks based on hash
public class StripedCounter {
    private static final int STRIPES = 16;
    private final Object[] locks = new Object[STRIPES];
    private final long[] counts = new long[STRIPES];

    public StripedCounter() {
        for (int i = 0; i < STRIPES; i++) locks[i] = new Object();
    }

    public void increment(String key) {
        int stripe = Math.abs(key.hashCode() % STRIPES);
        synchronized (locks[stripe]) { counts[stripe]++; }
    }

    public long total() {
        long sum = 0;
        for (int i = 0; i < STRIPES; i++)
            synchronized (locks[i]) { sum += counts[i]; }
        return sum;
    }
}
```
This is exactly how `ConcurrentHashMap` worked pre-Java-8 (Part 8.2) and how `LongAdder` works (Part 7.4).

## 3.5 JVM Lock Optimizations (Why `synchronized` Isn't Slow Anymore)

Modern JVMs optimize `synchronized` aggressively. Know these for interviews — and per Part F6, all of them are ultimately about deferring the expensive, OS-backed monitor for as long as possible:

| Optimization | What it does |
|---|---|
| **Biased locking** | If only one thread ever locks it, skip atomic ops entirely. *(Deprecated in JDK 15, removed in JDK 21 — modern workloads are more multi-threaded)* |
| **Thin/lightweight locking** | Uncontended lock via a single CAS on the object header (~20ns) |
| **Lock inflation** | Under contention, promote to a heavyweight OS monitor (park/unpark) |
| **Adaptive spinning** | Briefly spin before parking — if the lock is held for only nanoseconds, spinning beats a context switch |
| **Lock elision** | JIT proves the object never escapes the thread → removes the lock entirely |
| **Lock coarsening** | Merges adjacent `synchronized` blocks on the same lock into one |

```java
// Lock elision in action — JIT removes the StringBuffer's internal locks
public String concat(String a, String b) {
    StringBuffer sb = new StringBuffer();   // never escapes this method
    sb.append(a).append(b);                 // synchronized methods → elided
    return sb.toString();
}
```

**Why is elision even possible?** The JIT (Part F4) performs *escape analysis* on hot methods: if it can prove an object never leaves the current thread's call stack (Part F1) — never gets stored in a field another thread could read, never gets passed to unknown code — then by definition no *other* thread could ever contend for its lock, and the lock's entire purpose (mutual exclusion between threads) is vacuous. Removing it is provably safe, not a heuristic guess.

> ❓ **"So should I use `StringBuffer` or `StringBuilder`?"** Always `StringBuilder`. `StringBuffer`'s synchronization is almost never useful (a shared, mutable buffer across threads is already a design smell), and relying on JIT elision is fragile.

> 🎯 **Verdict: `synchronized` is fine for most code.** Don't reach for `ReentrantLock` for performance — reach for it when you need its *features* (Part 6).

---
---

# PART 4 — `wait()` / `notify()` — Thread Coordination

## 4.1 The Problem: Busy-Waiting Burns CPU

```java
// ⛔ Spin-waiting: one core pinned at 100% doing nothing
while (queue.isEmpty()) { }
Item item = queue.remove();
```

```java
// ⛔ Slightly less bad, but adds up to 100ms latency and still wakes up pointlessly
while (queue.isEmpty()) { Thread.sleep(100); }
```

You want: **"sleep until something actually changes."** That's `wait()`/`notify()` — a way to get a thread fully off the OS scheduler's runnable queue (Part F5's "park," costing nothing while idle) instead of burning a core checking a condition over and over, while still waking up promptly once the condition becomes true, rather than only on the next poll interval.

## 4.2 The Rules

1. You **must** hold the object's monitor to call `wait()`/`notify()` → always inside `synchronized`
2. `wait()` **releases** the lock and parks the thread
3. `notify()`/`notifyAll()` moves waiter(s) to the BLOCKED state; they reacquire the lock before `wait()` returns
4. **Always wait in a `while` loop, never an `if`**

Rule 1 exists because `wait()`/`notify()` coordinate through the *same* monitor mechanism `synchronized` uses (Part F6) — every object's mark word doubles as both a mutual-exclusion lock and a place to attach a wait queue of parked threads, and mixing "which condition changed" logic with anything other than the lock already guarding that condition would reopen exactly the race conditions locking was meant to close.

## 4.3 Producer-Consumer From Scratch

```java
public class BoundedBuffer<T> {
    private final Queue<T> queue = new LinkedList<>();
    private final int capacity;
    private final Object lock = new Object();

    public BoundedBuffer(int capacity) { this.capacity = capacity; }

    public void put(T item) throws InterruptedException {
        synchronized (lock) {
            while (queue.size() == capacity) {   // ✅ while, NOT if
                lock.wait();                     // releases lock, sleeps
            }
            queue.add(item);
            lock.notifyAll();                    // wake consumers
        }
    }

    public T take() throws InterruptedException {
        synchronized (lock) {
            while (queue.isEmpty()) {            // ✅ while
                lock.wait();
            }
            T item = queue.poll();
            lock.notifyAll();                    // wake producers
            return item;
        }
    }
}
```

## 4.4 Why `while` and Not `if` — Three Reasons

**Reason 1: Spurious wakeups.** The OS may wake a waiting thread for no reason at all. This is permitted by the POSIX spec and by the JLS — `wait()` is ultimately implemented via the same park/unpark machinery from Part F5, and the underlying OS primitives are allowed this looseness for implementation-efficiency reasons outside Java's control. With `if`, you proceed on a false premise and get an `IllegalStateException` or corrupt data.

**Reason 2: `notifyAll()` wakes everyone.** Three consumers wake up, one item available. Two of them must go back to waiting.

**Reason 3: A "barger" can steal the condition.** Between the notify and the waiter reacquiring the lock, a *third* thread can enter and consume the item. The waiter wakes to find the buffer empty again.

> 🎯 **Rule:** `wait()` tells you *"something may have changed."* It never tells you *"your condition is now true."* Always re-verify.

## 4.5 `notify()` vs `notifyAll()`

| | `notify()` | `notifyAll()` |
|---|---|---|
| Wakes | **One arbitrary** waiter | All waiters |
| Efficient? | Yes | No (thundering herd) |
| Safe? | **Only** if all waiters wait for the *same* condition and any one can proceed | Always |

**Why `notify()` can deadlock your app:** In `BoundedBuffer` above, producers and consumers wait on the *same* lock but for *different* conditions. If `notify()` picks a producer when the buffer is full, the producer sees the condition is still false, waits again — and the consumer that could have made progress was never woken. **Everything hangs.**

> 🎯 **Default to `notifyAll()`.** Use `notify()` only when you can prove all waiters are interchangeable. Or better — use `Condition` objects (Part 6.3), which give you *separate wait sets* so you can signal precisely.

## 4.6 ...And Now Never Write This Again

```java
// ✅ Everything above, in one line:
BlockingQueue<Task> queue = new LinkedBlockingQueue<>(1000);

// Producer
queue.put(task);        // blocks if full

// Consumer
Task t = queue.take();  // blocks if empty
```

> ❓ **"Then why did I just learn `wait`/`notify`?"**
> Three reasons: (1) it's asked in interviews to test whether you understand coordination; (2) you'll read it in legacy code and in library internals; (3) understanding *why* `while` is needed makes you understand `Condition.await()`, which has the identical requirement. But in new production code, **use `BlockingQueue`**.

---
---

# PART 5 — Liveness Hazards: Deadlock, Livelock, Starvation

## 5.1 Deadlock — The Four Coffman Conditions

Deadlock needs **all four** simultaneously. Break any one and deadlock is impossible.

| # | Condition | How to break it |
|---|---|---|
| 1 | **Mutual exclusion** — resource held exclusively | Use lock-free/immutable structures |
| 2 | **Hold and wait** — hold one lock while requesting another | Acquire all locks at once, or none |
| 3 | **No preemption** — locks can't be forcibly taken | Use `tryLock` with timeout |
| 4 | **Circular wait** — A waits for B, B waits for A | **Global lock ordering** ← the practical fix |

It's worth seeing why these four, together, are both *necessary* and *sufficient* for deadlock, rather than just memorizing the list. If locks weren't exclusive (#1), there'd be nothing to wait *for*. If a thread released everything it held before requesting more (breaking #2), no thread could ever be caught holding something another thread needs while itself waiting. If a stuck thread's locks could be forcibly reclaimed (breaking #3), the system could always recover. And if there were no *cycle* in who's waiting for whom (breaking #4), then somewhere in the chain a thread must be waiting only for locks nobody else needs, so it can always eventually proceed and the chain unwinds. Remove any single one, and the graph-theoretic argument for an inescapable stall no longer holds — which is exactly why the fixes below each target breaking just one condition rather than all four.

## 5.2 The Classic: Bank Transfer Deadlock

```java
// ⛔ DEADLOCKS
public void transfer(Account from, Account to, BigDecimal amount) {
    synchronized (from) {
        synchronized (to) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

```
Thread 1: transfer(accountA, accountB)  → locks A, waits for B
Thread 2: transfer(accountB, accountA)  → locks B, waits for A
                        ☠️ DEADLOCK
```

This is not theoretical — it happens under production load and looks like a random hang.

A useful way to see condition #4 (circular wait) concretely: draw a graph where each thread is a node, and draw an arrow from thread X to thread Y whenever X is waiting on a lock Y currently holds. Thread 1 → Thread 2 (waiting for B, which 2 holds) and Thread 2 → Thread 1 (waiting for A, which 1 holds) — a two-node cycle. Deadlock, in these terms, is exactly "this wait-for graph contains a cycle," which is also precisely what `ThreadMXBean.findDeadlockedThreads()` (5.7) computes under the hood.

### ✅ Fix 1: Global lock ordering

Always acquire locks in a consistent, globally-defined order. Use any total ordering — account ID works:

```java
public void transfer(Account from, Account to, BigDecimal amount) {
    if (from.getId() == to.getId()) throw new IllegalArgumentException("same account");

    Account first  = from.getId() < to.getId() ? from : to;
    Account second = from.getId() < to.getId() ? to   : from;

    synchronized (first) {
        synchronized (second) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```
Now **both** threads lock A then B. No cycle possible — with a fixed global order, the wait-for graph can never point "backwards," so it can never close into a cycle. This is condition #4 broken directly.

**When there's no natural ID**, use `System.identityHashCode()` with a tie-breaker lock:

```java
private static final Object TIE_LOCK = new Object();

public void transfer(Account from, Account to, BigDecimal amt) {
    int fh = System.identityHashCode(from), th = System.identityHashCode(to);
    if (fh < th)      { synchronized (from) { synchronized (to) { doTransfer(from,to,amt); } } }
    else if (th < fh) { synchronized (to)   { synchronized (from) { doTransfer(from,to,amt); } } }
    else { // rare hash collision
        synchronized (TIE_LOCK) {
            synchronized (from) { synchronized (to) { doTransfer(from,to,amt); } }
        }
    }
}
```

### ✅ Fix 2: `tryLock` with timeout and backoff

```java
public boolean transfer(Account from, Account to, BigDecimal amt, long timeoutMs)
        throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
    while (System.nanoTime() < deadline) {
        if (from.lock.tryLock(50, TimeUnit.MILLISECONDS)) {
            try {
                if (to.lock.tryLock(50, TimeUnit.MILLISECONDS)) {
                    try {
                        from.debit(amt); to.credit(amt);
                        return true;
                    } finally { to.lock.unlock(); }
                }
            } finally { from.lock.unlock(); }
        }
        // couldn't get both — release everything and retry with random jitter
        Thread.sleep(ThreadLocalRandom.current().nextInt(10, 50));
    }
    return false;   // caller decides: retry, queue, or fail the request
}
```
This breaks Coffman condition #2 (hold-and-wait) and #3 (no preemption): a thread that can't get everything it needs releases what it has instead of holding it hostage, so no other thread can ever be stuck waiting behind it indefinitely. The random backoff prevents livelock (5.5).

## 5.3 Lock-Ordering Deadlock via Alien Method Calls (the sneaky one)

```java
// ⛔ Deadlock hiding in plain sight
class Portfolio {
    private final Set<Listener> listeners = new HashSet<>();
    public synchronized void addStock(Stock s) {
        stocks.add(s);
        for (Listener l : listeners) l.onStockAdded(s);   // ⛔ ALIEN METHOD while holding lock
    }
}
```
You have no idea what `onStockAdded` does. If it calls back into another synchronized object which calls back into `Portfolio`, you deadlock. This is common with observer/listener patterns, ORM lifecycle callbacks, and Spring event listeners.

**✅ Fix — open call: copy state, release lock, then call out.**

```java
public void addStock(Stock s) {
    List<Listener> snapshot;
    synchronized (this) {
        stocks.add(s);
        snapshot = new ArrayList<>(listeners);   // copy inside lock
    }
    for (Listener l : snapshot) l.onStockAdded(s);   // call outside lock
}
// Or use CopyOnWriteArrayList for listeners — iteration needs no lock at all (Part 8.4)
```

## 5.4 Resource Deadlocks (No Locks Involved!)

Deadlock doesn't need `synchronized`. Any finite resource works — the four Coffman conditions in 5.1 never mentioned `synchronized` specifically, only "exclusive resource," and a thread-pool slot or a connection-pool slot is just as exclusive a resource as a monitor.

**Thread pool deadlock — a real production killer:**

```java
// ⛔ Single-threaded pool where a task waits on another task in the SAME pool
ExecutorService pool = Executors.newSingleThreadExecutor();
Future<String> outer = pool.submit(() -> {
    Future<String> inner = pool.submit(() -> "inner result");
    return inner.get();   // ☠️ waits for a task that can never be scheduled
});
```
The single thread is occupied by `outer`, so `inner` sits in the queue forever.

**This generalizes:** if tasks in a bounded pool of size N depend on other tasks in the *same* pool, you can deadlock. **Rule: never submit dependent tasks to the same bounded pool.** Use separate pools per "layer," or use `CompletableFuture` composition (Part 10) which doesn't block a thread while waiting.

**Connection pool + lock deadlock:**
```java
// Thread A: holds DB connection, waits for a lock
// Thread B: holds the lock, waits for a DB connection
// Pool size 1 → deadlock
```
**Rule: always acquire resources in the same global order — including implicit resources like DB connections and semaphore permits.**

## 5.5 Livelock

Threads aren't blocked — they're actively running — but make **no progress**.

> Two people in a hallway, each stepping aside to let the other pass, repeatedly, forever.

```java
// ⛔ Livelock: both threads politely release and retry in lockstep
while (true) {
    if (lock1.tryLock()) {
        if (lock2.tryLock()) { doWork(); return; }
        lock1.unlock();     // both release at the same instant
    }
    // no backoff → both retry at the same instant → repeat forever
}
```

**✅ Fix: randomized exponential backoff.** Break the symmetry.
```java
Thread.sleep(ThreadLocalRandom.current().nextInt(1, 100));
```

**Real-world livelock:** A message fails processing, gets rolled back to the queue, is redelivered, fails again, forever — a **poison message loop**. This burns CPU and floods logs while zero work gets done. **Fix:** a retry counter and a **dead-letter queue (DLQ)** after N attempts. This is standard in every Kafka/SQS/RabbitMQ pipeline.

## 5.6 Starvation

A thread never gets CPU or a lock it needs.

**Causes:**
- Unfair locks: a fast thread repeatedly reacquires a lock before the queued waiter is scheduled ("barging")
- Priority inversion: a low-priority thread holds a lock a high-priority thread needs
- Long-held locks: one thread does slow I/O under a lock

**Fix: fair locks** (see Part 6.2) — but they're ~10-100x slower under contention because every handoff requires a context switch (Part F5's expensive OS-level round trip, paid on every single acquire instead of only when genuinely necessary). Usually the real fix is to shorten the critical section.

## 5.7 Deadlock Detection in Production

**1. Take a thread dump** — `jstack <pid>` or `kill -3 <pid>`. The JVM automatically finds and prints intrinsic-lock deadlocks:

```
Found one Java-level deadlock:
=============================
"Thread-1":
  waiting to lock monitor 0x... (object 0x000000076ab6..., a Account),
  which is held by "Thread-0"
"Thread-0":
  waiting to lock monitor 0x... (object 0x000000076ab7..., a Account),
  which is held by "Thread-1"
```

**2. Programmatic detection** (useful for a health-check endpoint):
```java
ThreadMXBean bean = ManagementFactory.getThreadMXBean();
long[] deadlocked = bean.findDeadlockedThreads();   // includes Lock-based deadlocks
if (deadlocked != null) {
    ThreadInfo[] infos = bean.getThreadInfo(deadlocked, true, true);
    for (ThreadInfo i : infos) log.error("DEADLOCK: {}", i);
    alerting.pageOncall("Deadlock detected");
}
```

**3. Prevention checklist**
- [ ] Document a global lock ordering for your service
- [ ] Never hold a lock across I/O or an alien method call
- [ ] Prefer `tryLock(timeout)` over `lock()` in anything user-facing
- [ ] Never submit dependent tasks to the same bounded pool
- [ ] Prefer one coarse lock over two fine ones unless profiling says otherwise
- [ ] Prefer concurrent collections over hand-rolled locking

---
---

# PART 6 — Explicit Locks: `ReentrantLock`, `ReadWriteLock`, `StampedLock`

## 6.1 Why `synchronized` Isn't Always Enough

| Need | `synchronized` | `ReentrantLock` |
|---|---|---|
| Try to acquire, give up if busy | ❌ | ✅ `tryLock()` |
| Timeout while acquiring | ❌ | ✅ `tryLock(t, unit)` |
| Interruptible acquisition | ❌ (stuck forever) | ✅ `lockInterruptibly()` |
| Fair (FIFO) ordering | ❌ | ✅ `new ReentrantLock(true)` |
| Lock in one method, unlock in another | ❌ (block-structured) | ✅ (hand-over-hand locking) |
| Multiple wait conditions | ❌ (one wait set) | ✅ `newCondition()` |
| Auto-release on exception | ✅ automatic | ❌ **you must use `finally`** |
| Readable / hard to misuse | ✅ | ⚠️ easy to forget `unlock()` |

The reason `synchronized`'s column looks so bare isn't that the JVM engineers overlooked these features — it's that `synchronized`'s block-structured syntax (`synchronized (x) { ... }`) *is itself* the source of its one big advantage (auto-release) and every one of its limitations. Because the lock is tied to lexical scope, the JVM can guarantee release even on an exception (no `finally` needed) — but that same rigidity means there's no way to ask "try for 50ms and give up," or to lock in one method and unlock in another, or to have two separate wait-queues for two separate conditions (Part 4.5's `notify()` problem). `ReentrantLock` is ordinary Java code built on `AbstractQueuedSynchronizer` (6.6) rather than a language keyword, which is exactly what buys it that flexibility — at the cost of needing you to manage the release yourself.

## 6.2 `ReentrantLock` — The Mandatory Idiom

```java
private final ReentrantLock lock = new ReentrantLock();

public void update() {
    lock.lock();
    try {              // ✅ `try` IMMEDIATELY after lock() — nothing between them
        mutateSharedState();
    } finally {
        lock.unlock();  // ✅ ALWAYS in finally
    }
}
```

> ⚠️ **If you forget `finally`, an exception leaks the lock permanently and your entire application eventually hangs.** This is the price of `ReentrantLock`'s flexibility. It's the single reason to prefer `synchronized` when you don't need the extra features.

### `tryLock` — non-blocking attempt

```java
// Use case: metrics/cache refresh that should be SKIPPED if another thread is already doing it
public void refreshCacheIfIdle() {
    if (!refreshLock.tryLock()) {
        log.debug("Refresh already in progress, skipping");
        return;                       // ← don't queue up 50 redundant refreshes
    }
    try { cache.reload(); }
    finally { refreshLock.unlock(); }
}
```

### `tryLock(timeout)` — bounded waiting

```java
// Use case: an HTTP handler with an SLA — better to return 503 than hang the request
public Response handle(Request req) throws InterruptedException {
    if (!lock.tryLock(200, TimeUnit.MILLISECONDS)) {
        metrics.counter("lock.timeout").increment();
        return Response.status(503).entity("Service busy, retry").build();
    }
    try { return process(req); }
    finally { lock.unlock(); }
}
```
**This is how you build backpressure instead of cascading failure.** With `synchronized`, threads pile up invisibly until the pool is exhausted and the whole service dies.

### `lockInterruptibly()` — cancellable acquisition

```java
public void doWork() throws InterruptedException {
    lock.lockInterruptibly();   // responds to Thread.interrupt() while waiting
    try { work(); }
    finally { lock.unlock(); }
}
```
Essential for graceful shutdown — with `synchronized`, a thread waiting on a monitor cannot be interrupted at all (the JVM's built-in monitor wait queue, Part F6, doesn't check the interrupt flag the way AQS's queue, 6.6, does).

### Fairness

```java
ReentrantLock fair = new ReentrantLock(true);    // FIFO order, no starvation
ReentrantLock unfair = new ReentrantLock();      // default — barging allowed
```

| | Fair | Unfair (default) |
|---|---|---|
| Order | Strict FIFO | Whoever gets there (barging) |
| Throughput | **Much lower** (every handoff = context switch) | Much higher |
| Starvation | Impossible | Possible in theory, rare in practice |
| Latency variance | Low & predictable | Low mean, long tail |

Why is fair so much slower? An unfair lock lets a thread that's *currently running* grab the lock the instant it's free, even if another thread has been queued waiting longer — no context switch (Part F5) is needed at all if the requester is already running. A fair lock refuses that shortcut and always hands off to the longest-waiting queued thread, which — if that thread was parked — necessarily costs a full park/unpark round trip (Part F5) on every single handoff, whether or not a running thread was right there ready to go.

> 🎯 **Use fair only when starvation is observed and tail latency matters more than throughput.** Default to unfair. The `ThreadPoolExecutor` and `ConcurrentHashMap` all use unfair locking.

### Useful introspection methods (great for monitoring)
```java
lock.isLocked();          lock.isHeldByCurrentThread();
lock.getHoldCount();      lock.getQueueLength();   // ← export this as a metric!
```

## 6.3 `Condition` — Multiple Wait Sets

The killer feature. Remember Part 4's `notifyAll()` problem — waking producers when you meant consumers? `Condition` fixes it.

```java
public class BoundedBuffer<T> {
    private final Object[] items;
    private int putIdx, takeIdx, count;

    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull  = lock.newCondition();   // ← separate wait set
    private final Condition notEmpty = lock.newCondition();   // ← separate wait set

    public BoundedBuffer(int cap) { items = new Object[cap]; }

    public void put(T x) throws InterruptedException {
        lock.lock();
        try {
            while (count == items.length) notFull.await();    // wait ONLY on "full"
            items[putIdx] = x;
            if (++putIdx == items.length) putIdx = 0;
            count++;
            notEmpty.signal();   // ✅ wake exactly ONE consumer — no thundering herd
        } finally { lock.unlock(); }
    }

    @SuppressWarnings("unchecked")
    public T take() throws InterruptedException {
        lock.lock();
        try {
            while (count == 0) notEmpty.await();
            T x = (T) items[takeIdx];
            items[takeIdx] = null;
            if (++takeIdx == items.length) takeIdx = 0;
            count--;
            notFull.signal();    // ✅ wake exactly ONE producer
            return x;
        } finally { lock.unlock(); }
    }
}
```

This is (almost exactly) the real source of `ArrayBlockingQueue`. Now `signal()` is safe because each condition has its own homogeneous wait set — one `ReentrantLock` guards the shared array, but `notFull` and `notEmpty` each maintain their own independent queue of parked threads, so signalling one never wakes a thread waiting for the other.

**Mapping:**

| Intrinsic | `Condition` |
|---|---|
| `obj.wait()` | `condition.await()` |
| `obj.wait(ms)` | `condition.await(t, unit)` / `awaitNanos` |
| `obj.notify()` | `condition.signal()` |
| `obj.notifyAll()` | `condition.signalAll()` |

Same rules apply: must hold the lock, and **always `await()` in a `while` loop**.

## 6.4 `ReadWriteLock` — Many Readers, One Writer

**The insight:** concurrent reads are safe. Only writes need exclusivity — this is the same principle a database's shared/exclusive row locks use, applied to in-process memory instead of disk rows.

```java
public class ConfigStore {
    private final Map<String, String> config = new HashMap<>();
    private final ReadWriteLock rw = new ReentrantReadWriteLock();
    private final Lock readLock  = rw.readLock();
    private final Lock writeLock = rw.writeLock();

    public String get(String key) {
        readLock.lock();                 // MANY threads can hold this simultaneously
        try { return config.get(key); }
        finally { readLock.unlock(); }
    }

    public void put(String key, String value) {
        writeLock.lock();                // EXCLUSIVE — blocks all readers & writers
        try { config.put(key, value); }
        finally { writeLock.unlock(); }
    }
}
```

**When it wins:** read:write ratio ≥ ~10:1 **and** reads take meaningful time. Config stores, in-memory reference data (currency rates, feature flags, routing tables), read-heavy caches.

**When it loses:** short critical sections. The bookkeeping overhead of RW locks (tracking reader count, distinguishing which of many possible readers/writers currently hold what) exceeds the benefit — a plain `ReentrantLock` or `synchronized` is faster. **Measure, don't assume.**

### Lock downgrading (allowed) vs upgrading (deadlocks)

```java
// ✅ DOWNGRADE: write → read is legal
writeLock.lock();
try {
    data = recompute();
    readLock.lock();          // acquire read BEFORE releasing write
} finally { writeLock.unlock(); }
try { use(data); }            // still holding read lock — no writer can interleave
finally { readLock.unlock(); }

// ⛔ UPGRADE: read → write DEADLOCKS
readLock.lock();
writeLock.lock();   // ☠️ waits for all readers to release — including yourself
```

Why does downgrading work but upgrading deadlock? Acquiring the read lock *before* releasing the write lock (downgrade) never has to wait on anyone — you already hold exclusive access, so no other reader could possibly be active to conflict with. Acquiring the write lock while already holding a read lock (upgrade) requires waiting for *every* current reader to release — including yourself, since you're one of them, and you never will release while blocked waiting for the write lock. It's a one-thread version of Part 5.1's circular wait, self-inflicted.

## 6.5 `StampedLock` (Java 8+) — Optimistic Reading

Faster than `ReadWriteLock` for read-dominated workloads, because optimistic reads acquire **no lock at all**.

```java
public class Point {
    private double x, y;
    private final StampedLock sl = new StampedLock();

    public void move(double dx, double dy) {
        long stamp = sl.writeLock();
        try { x += dx; y += dy; }
        finally { sl.unlockWrite(stamp); }
    }

    public double distanceFromOrigin() {
        long stamp = sl.tryOptimisticRead();      // ← no lock acquired, just a version
        double cx = x, cy = y;                    // read into locals
        if (!sl.validate(stamp)) {                // did a writer interfere?
            stamp = sl.readLock();                // fall back to a real read lock
            try { cx = x; cy = y; }
            finally { sl.unlockRead(stamp); }
        }
        return Math.sqrt(cx * cx + cy * cy);
    }
}
```

The "stamp" is just a version counter (the same idea Part 7.5's `AtomicStampedReference` uses to solve ABA): `tryOptimisticRead()` hands you the current version without blocking anyone, you read the fields into locals *optimistically assuming* no writer interferes, and `validate(stamp)` cheaply checks whether the version is still the same. If a writer snuck in between, the version moved, `validate` fails, and you fall back to a real, blocking read lock — you're betting that writes are rare enough that paying for a real lock only on the rare occasions a write actually raced you is a net win over paying for one on every single read.

⚠️ **`StampedLock` restrictions:**
- **NOT reentrant** — recursive acquisition self-deadlocks
- No `Condition` support
- Optimistic reads must copy fields into locals and only use them **after** `validate()` passes
- Easy to get wrong — use it only in measured hot paths

| Lock | Reentrant | Fairness | Conditions | Optimistic reads | Best for |
|---|---|---|---|---|---|
| `synchronized` | ✅ | ❌ | 1 wait set | ❌ | Default choice |
| `ReentrantLock` | ✅ | ✅ optional | ✅ many | ❌ | Timeouts, interruptibility, conditions |
| `ReentrantReadWriteLock` | ✅ | ✅ optional | ✅ (write only) | ❌ | Heavy read:write imbalance, longer reads |
| `StampedLock` | ❌ | ❌ | ❌ | ✅ | Very hot, very short read paths |

## 6.6 `AbstractQueuedSynchronizer` (AQS) — What Everything Is Built On

`ReentrantLock`, `Semaphore`, `CountDownLatch`, `ReentrantReadWriteLock`, and `ThreadPoolExecutor`'s internal worker lock are all thin wrappers over **AQS** (written by Doug Lea).

**The core idea:** AQS maintains
1. A single `volatile int state` — the meaning is defined by the subclass
2. A **CLH-variant FIFO queue** of waiting threads (a lock-free doubly-linked list)

| Synchronizer | What `state` means |
|---|---|
| `ReentrantLock` | Hold count (0 = free, n = held n times reentrantly) |
| `Semaphore` | Number of available permits |
| `CountDownLatch` | Remaining count (releases everyone at 0) |
| `ReentrantReadWriteLock` | 16 high bits = read holders, 16 low bits = write holds |

**Acquire flow:**
```
1. tryAcquire(arg)  — subclass-defined CAS on `state`
   success → done, thread never blocks (the fast path, ~20ns)
2. failure → enqueue this thread as a node in the FIFO queue
3. spin briefly, then LockSupport.park(this)   ← thread is descheduled
4. On release: predecessor calls LockSupport.unpark(successor)
```

Notice the shape of this: step 1 is a CAS attempt on a single shared `volatile int` — exactly the lock-free, hardware-atomic operation from Part F7 — and only once that fails (meaning genuine contention exists) does AQS fall back to building a real queue and actually parking a thread via the OS (Part F5). This is the *general* version of the exact two-tier strategy Part F6 described specifically for `synchronized`'s mark-word CAS versus monitor inflation — AQS is Doug Lea's reusable implementation of that same "cheap fast path, expensive fallback" pattern, made available to any synchronizer that can express its state as a single int.

`LockSupport.park()`/`unpark()` are the low-level primitives: they park a thread with a **permit** semantic, so an `unpark` that arrives *before* the `park` is not lost (unlike `wait`/`notify`, where a notify before a wait is lost forever). That's why AQS doesn't need a lock to coordinate its own queue.

Writing your own synchronizer:
```java
// A simple non-reentrant mutex — shows how little code AQS needs
class Mutex {
    private static class Sync extends AbstractQueuedSynchronizer {
        @Override protected boolean tryAcquire(int ignored) {
            return compareAndSetState(0, 1);          // 0 = free, 1 = held
        }
        @Override protected boolean tryRelease(int ignored) {
            setState(0); return true;
        }
        @Override protected boolean isHeldExclusively() { return getState() == 1; }
    }
    private final Sync sync = new Sync();
    public void lock()   { sync.acquire(1); }
    public void unlock() { sync.release(1); }
}
```

> 🎯 **Why an SDE 2 should know this:** it explains *why* `ReentrantLock` waiters show as `WAITING` (parked) rather than `BLOCKED`, why fairness is just "check the queue before barging," and why all these classes share the same performance characteristics. It's also a common "how would you implement X" follow-up.

---
---

# PART 7 — Atomic Variables & CAS (Lock-Free Programming)

## 7.1 The Problem With Locks

Locks are **pessimistic**: "someone might interfere, so I'll block everyone." Costs:
- Blocked threads → context switches (~1–10 µs each, Part F5)
- A thread that is descheduled *while holding* a lock stalls everyone (convoying)
- Risk of deadlock/priority inversion

**Optimistic alternative:** "Assume no one interferes. Try the update. If someone did interfere, detect it and retry." That's **CAS**.

## 7.2 Compare-And-Swap (CAS)

CAS is a **single atomic CPU instruction** (`CMPXCHG` on x86, `LDREX/STREX` on ARM) — the same instruction introduced conceptually in Part F7. Its atomicity is enforced directly by the CPU's cache-coherence hardware (Part F2), not by any OS involvement, which is exactly why it can be so much cheaper than blocking.

```
CAS(memoryLocation, expectedValue, newValue):
    atomically:
        if (*memoryLocation == expectedValue) {
            *memoryLocation = newValue;
            return true;
        }
        return false;
```

`AtomicInteger.incrementAndGet()` is essentially:

```java
public int incrementAndGet() {
    int current, next;
    do {
        current = get();              // read
        next = current + 1;           // compute
    } while (!compareAndSet(current, next));   // retry if someone beat us
    return next;
}
```

If another thread changed the value between the read and the CAS, `compareAndSet` fails and we simply loop. **No blocking, no context switch.**

> ❓ **"Isn't the retry loop just busy-waiting?"**
> No. A blocked thread waits for a *scheduler decision* (microseconds, via the park/unpark syscall round-trip from Part F5). A CAS retry is a few nanoseconds — a plain read, a compute, and one hardware instruction — and only happens under actual contention. Under **low-to-moderate** contention CAS crushes locks. Under **very high** contention (dozens of threads hammering one variable), CAS retries thrash — every core is repeatedly invalidating the same cache line for every other core (Part F2's coherence traffic, at its worst) — and locks (or `LongAdder`, 7.4) win.

## 7.3 The Atomic Classes

```java
// Scalars
AtomicInteger  AtomicLong  AtomicBoolean

// References
AtomicReference<V>
AtomicStampedReference<V>   // adds a version stamp → solves ABA
AtomicMarkableReference<V>  // adds a boolean mark

// Arrays (element-wise atomicity)
AtomicIntegerArray  AtomicLongArray  AtomicReferenceArray

// High-contention accumulators (Java 8+)
LongAdder  LongAccumulator  DoubleAdder  DoubleAccumulator

// Field updaters (save memory — no wrapper object per field)
AtomicIntegerFieldUpdater  AtomicLongFieldUpdater  AtomicReferenceFieldUpdater
```

### `AtomicInteger` in practice

```java
public class RequestMetrics {
    private final AtomicLong totalRequests = new AtomicLong();
    private final AtomicLong errors        = new AtomicLong();

    public void recordSuccess() { totalRequests.incrementAndGet(); }
    public void recordError()   { totalRequests.incrementAndGet(); errors.incrementAndGet(); }

    public double errorRate() {
        long t = totalRequests.get();
        return t == 0 ? 0 : (double) errors.get() / t;
    }
}
```

**Key methods:**
| Method | Meaning |
|---|---|
| `get()` / `set(v)` | volatile read/write |
| `incrementAndGet()` / `getAndIncrement()` | ++x / x++ |
| `addAndGet(d)` / `getAndAdd(d)` | |
| `compareAndSet(exp, new)` | CAS; returns success boolean |
| `getAndSet(v)` | atomic swap, returns old |
| `updateAndGet(fn)` | apply a function atomically (with retry loop built in) |
| `accumulateAndGet(x, fn)` | combine with a value atomically |
| `lazySet(v)` | cheaper write, no immediate visibility guarantee (advanced) |

Every one of these classes wraps a single field marked internally the same way `volatile` marks a field (Part 2.4) — that's what makes `get()`/`set()` a plain visible read/write with no locking — and layers CAS-based retry loops like the `incrementAndGet` example above on top for the compound operations. There's no exotic new mechanism here beyond `volatile` (F3) plus CAS (F7): the atomic classes are a thin, convenient package around the same two primitives you've already seen.

### `AtomicReference` — atomic updates to an object

```java
// Lock-free "update immutable state" pattern — very common
public class CircuitBreaker {
    private final AtomicReference<State> state = new AtomicReference<>(State.closed());

    public void recordFailure() {
        state.updateAndGet(s -> {                   // retries automatically on conflict
            State next = s.withFailure();
            return next.failures() >= 5 ? State.open(Instant.now()) : next;
        });
    }
}
// `State` MUST be immutable for this to be correct.
```

> ⚠️ **`updateAndGet`'s function must be side-effect-free and idempotent** — it may be invoked multiple times due to CAS retries. Never log, never mutate, never call a DB inside it.

### `compareAndSet` for state machines

```java
// Ensure a job transitions PENDING → RUNNING exactly once, even with N workers racing
private final AtomicReference<Status> status = new AtomicReference<>(Status.PENDING);

public boolean claim() {
    return status.compareAndSet(Status.PENDING, Status.RUNNING);
    // Exactly one worker gets `true`. Others get `false` and move on.
}
```
This is the in-JVM version of the distributed "claim a job row with `UPDATE ... WHERE status='PENDING'`" pattern.

## 7.4 `LongAdder` — When Atomics Get Contended

Under heavy contention (e.g., 32 threads incrementing one counter), `AtomicLong` CAS loops thrash: every core fights over one cache line (Part F2) — every successful CAS on one core invalidates every other core's cached copy, so the *next* thread's CAS is now guaranteed to also require a fresh, slow fetch, and probably fails and must retry too.

`LongAdder` keeps **an array of internal cells**, one per contending thread (striping again!), and sums them only when you ask. By spreading writes across separate cells that (thanks to internal padding — Part 15.3's `@Contended`) don't share cache lines, most increments become genuinely independent, cache-coherence-free operations instead of a pile-up on one shared line.

```java
LongAdder requestCount = new LongAdder();
requestCount.increment();       // writes to a per-thread cell — almost zero contention
long total = requestCount.sum(); // adds all cells (a slightly stale snapshot)
```

| | `AtomicLong` | `LongAdder` |
|---|---|---|
| Write throughput under contention | Poor | **Excellent** (often 5–10x) |
| Read (`get`/`sum`) | O(1), exact | O(cells), approximate under concurrent writes |
| Memory | 1 long | Up to ~#cores cache-padded cells |
| Supports CAS/`compareAndSet` | ✅ | ❌ |

> 🎯 **Rule:** high write, rare read → `LongAdder` (metrics counters, hit/miss rates, request counts). Need the exact value at every read, or need CAS → `AtomicLong`.
>
> This is exactly why **Micrometer / Dropwizard Metrics counters use `LongAdder` internally.**

```java
LongAccumulator max = new LongAccumulator(Long::max, Long.MIN_VALUE);
max.accumulate(latencyMs);   // lock-free running maximum
```

## 7.5 The ABA Problem

```
Thread 1: reads value A
Thread 2: changes A → B → back to A
Thread 1: CAS(expected=A, new=C) → SUCCEEDS
          ...but the world changed in between. Thread 1's assumption was wrong.
```

Notice this is a direct consequence of what CAS actually checks (7.2's pseudocode): it only compares the *current value* against the *expected value* — it has no memory of the history in between, so "still equal to what I last read" and "never changed since I last read it" are quietly treated as the same thing, when they're not.

For an `int` counter, ABA is usually harmless. For **references** — especially in lock-free stacks/queues where a node may be recycled — it causes corruption.

**Fix: `AtomicStampedReference`** — CAS on (reference, version) together.

```java
AtomicStampedReference<Node> head = new AtomicStampedReference<>(node, 0);

int[] stampHolder = new int[1];
Node current = head.get(stampHolder);
int stamp = stampHolder[0];

// Succeeds only if BOTH the reference AND the version are unchanged
head.compareAndSet(current, newNode, stamp, stamp + 1);
```

**Real-world analogy:** optimistic locking in JPA/Hibernate with `@Version`. Same idea, different layer:
```sql
UPDATE accounts SET balance=?, version=version+1 WHERE id=? AND version=?
-- 0 rows updated → someone else changed it → retry or fail
```

## 7.6 A Complete Lock-Free Stack (Treiber Stack)

```java
public class LockFreeStack<E> {
    private static final class Node<E> {
        final E item; final Node<E> next;
        Node(E item, Node<E> next) { this.item = item; this.next = next; }
    }

    private final AtomicReference<Node<E>> top = new AtomicReference<>();

    public void push(E item) {
        Node<E> newHead, oldHead;
        do {
            oldHead = top.get();
            newHead = new Node<>(item, oldHead);
        } while (!top.compareAndSet(oldHead, newHead));   // retry until we win
    }

    public E pop() {
        Node<E> oldHead, newHead;
        do {
            oldHead = top.get();
            if (oldHead == null) return null;
            newHead = oldHead.next;
        } while (!top.compareAndSet(oldHead, newHead));
        return oldHead.item;
    }
}
```

**Why it's immune to ABA here:** we allocate a *new* `Node` on every push and never recycle them; the GC guarantees a live node's address isn't reused. **Garbage collection is a genuine advantage for lock-free programming in Java** — C++ needs hazard pointers or epoch reclamation.

> 🎯 **Don't write these in production.** Use `ConcurrentLinkedDeque` / `ConcurrentLinkedQueue`. Know the pattern for interviews and for reading library source.

### Progress guarantee vocabulary (interview terminology)

| Term | Guarantee |
|---|---|
| **Blocking** | A stalled thread can block everyone (locks) |
| **Obstruction-free** | A thread makes progress if it runs in isolation |
| **Lock-free** | *At least one* thread always makes progress system-wide (CAS loops) |
| **Wait-free** | *Every* thread completes in a bounded number of steps (strongest, rarest) |

## 7.7 `VarHandle` (Java 9+) — the Modern `Unsafe`

```java
class Counter {
    private volatile long value;
    private static final VarHandle VALUE;
    static {
        try {
            VALUE = MethodHandles.lookup().findVarHandle(Counter.class, "value", long.class);
        } catch (ReflectiveOperationException e) { throw new ExceptionInInitializerError(e); }
    }
    void increment() {
        long v;
        do { v = (long) VALUE.getVolatile(this); }
        while (!VALUE.compareAndSet(this, v, v + 1));
    }
}
```
Gives fine-grained memory-order control (`getPlain`, `getOpaque`, `getAcquire`, `setRelease`) without `sun.misc.Unsafe`. These access modes are, essentially, a menu of exactly which Part F3 barrier semantics you want on a given access — `getPlain` requests none at all (fastest, only safe if you already know there's no cross-thread visibility concern), `getAcquire`/`setRelease` request exactly the acquire/release barriers a `volatile` field would give you, and `getOpaque` is a middle ground (no reordering with *other* atomic accesses, but no full cross-thread ordering guarantee either). **SDE-2 "know it exists" material** — you'll see it in JDK and Netty source.

---
---

# PART 8 — Concurrent Collections

> **This is where 95% of real production concurrency lives.** Most services never write a `synchronized` block — they use these.

## 8.1 Why Not `Collections.synchronizedMap()`?

```java
Map<String,String> m = Collections.synchronizedMap(new HashMap<>());
```
Three problems:

**1. One global lock.** Every operation, read or write, serializes on the same monitor. Zero scalability.

**2. Compound operations are still not atomic.**
```java
// ⛔ RACE — two separate atomic ops, not one
if (!m.containsKey(k)) {   // ← another thread can insert here
    m.put(k, v);
}
```
You'd need external synchronization — at which point you're back to a global lock.

**3. Iteration throws `ConcurrentModificationException`** unless you manually synchronize the whole loop (blocking everything).

```java
// Required with synchronizedMap:
synchronized (m) {                       // ⛔ blocks ALL access during the whole iteration
    for (String k : m.keySet()) { ... }
}
```

> ⚠️ `Hashtable` and `Vector` are the ancient versions of the same idea. **Never use them in new code.**

## 8.2 `ConcurrentHashMap` — The Workhorse

### Internals (know this for interviews)

**Java 7:** *Segment locking.* The map was split into 16 segments, each with its own lock. 16 concurrent writers max.

**Java 8+:** *Per-bin (bucket) locking + CAS.*
- Empty bin → insert via **CAS** (Part F7 — one hardware instruction, no lock at all)
- Non-empty bin → `synchronized` on the **first node of that bin only** (a genuine object, so this is exactly Part F6/Part 3's mark-word locking, just scoped to one tiny piece of the map instead of the whole thing)
- Reads are **completely lock-free** (nodes hold `volatile` value/next — Part F3's visibility guarantee without ever needing mutual exclusion, since a read never modifies anything)
- Bins with >8 entries convert from linked list to **red-black tree** → O(log n) worst case instead of O(n) (this also mitigates hash-collision DoS attacks)
- Resizing is **concurrent** — multiple threads cooperate to transfer bins

Result: concurrency level ≈ number of buckets (thousands), not 16 — this is lock striping (Part 3.4) taken to its logical extreme: instead of 16 fixed stripes, there are as many independent lock points as there are buckets, so two threads writing to different buckets essentially never contend at all.

### Atomic compound operations — the reason it exists

```java
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();

map.putIfAbsent(k, v);              // insert only if absent — atomic
map.computeIfAbsent(k, key -> expensiveLoad(key));   // atomic lazy init
map.computeIfPresent(k, (key,val) -> val + 1);
map.compute(k, (key,val) -> val == null ? 1 : val + 1);
map.merge(k, 1, Integer::sum);      // ← the idiomatic concurrent counter
map.remove(k, expectedValue);       // conditional remove
map.replace(k, oldVal, newVal);     // conditional replace
```

**Word frequency counter — three ways:**
```java
// ⛔ Broken: read-modify-write race
map.put(word, map.getOrDefault(word, 0) + 1);

// ✅ Correct and clean
map.merge(word, 1, Integer::sum);

// ✅ Correct and fastest for very hot counters (no boxing churn, no CAS retries)
ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();
counts.computeIfAbsent(word, k -> new LongAdder()).increment();
```

### ⚠️ `computeIfAbsent` gotchas

```java
// ⛔ DEADLOCK (Java 9+ throws IllegalStateException instead — but still broken)
map.computeIfAbsent("a", k -> map.computeIfAbsent("b", k2 -> 1));
```
The mapping function runs **while holding the bin's lock**. So:
- Never update the *same* map inside it
- Never do slow I/O inside it (you're blocking every other writer to that bin)
- Never call unknown/alien code inside it

This is exactly Part 3.4's "never call alien code while holding a lock" rule, just easy to forget because `computeIfAbsent` doesn't *look* like it's inside a `synchronized` block — but under the hood, per the internals above, it very much is.

**Correct pattern for a cache with slow loads:**
```java
// Store a Future — the lock is held only long enough to insert the placeholder
ConcurrentHashMap<Key, Future<Value>> cache = new ConcurrentHashMap<>();

public Value get(Key key) throws Exception {
    Future<Value> f = cache.get(key);
    if (f == null) {
        FutureTask<Value> ft = new FutureTask<>(() -> slowLoad(key));
        f = cache.putIfAbsent(key, ft);
        if (f == null) { f = ft; ft.run(); }   // we won the race — do the work
    }
    try { return f.get(); }
    catch (ExecutionException e) { cache.remove(key, f); throw e; }  // don't cache failures
}
```
This is the **memoizer** pattern from *Java Concurrency in Practice* — it guarantees the expensive load happens **exactly once** even with 100 threads asking simultaneously (preventing a **cache stampede** / thundering herd on your database). In real projects, use **Caffeine**, which does this plus TTL, size eviction, and refresh-ahead.

### Iteration semantics: weakly consistent

`ConcurrentHashMap` iterators **never throw `ConcurrentModificationException`**. They reflect the state at some point during iteration and may or may not show concurrent modifications. No exceptions, no snapshot guarantee.

> ⚠️ **`size()` and `isEmpty()` are approximations** under concurrent modification. Never use `chm.size()` in a correctness-critical check.

### Bulk parallel operations (Java 8+)
```java
map.forEach(4, (k, v) -> process(k, v));                 // parallelism threshold
map.search(4, (k, v) -> v > 100 ? k : null);
map.reduce(4, (k,v) -> v, Integer::sum);
```

### ❌ `ConcurrentHashMap` does not allow null keys or values
Because `map.get(k) == null` would be ambiguous: "absent" or "mapped to null"? In a single-threaded `HashMap` you can disambiguate with `containsKey`; concurrently, the answer could change between the two calls. So nulls are banned. **Use `Optional` or a sentinel object.**

## 8.3 `BlockingQueue` — The Producer-Consumer Backbone

The single most useful concurrency abstraction in application code.

### Four flavors of every operation

| Operation | Throws exception | Returns special value | **Blocks** | Times out |
|---|---|---|---|---|
| Insert | `add(e)` | `offer(e)` → false | `put(e)` | `offer(e, t, unit)` |
| Remove | `remove()` | `poll()` → null | `take()` | `poll(t, unit)` |
| Examine | `element()` | `peek()` → null | — | — |

### The implementations

| Implementation | Bounded? | Notes / When to use |
|---|---|---|
| `ArrayBlockingQueue` | ✅ fixed | Array-backed, single lock. Predictable memory. Supports fairness. |
| `LinkedBlockingQueue` | Optional (defaults to `Integer.MAX_VALUE` ⚠️) | Separate head/tail locks → higher throughput. **Always pass a capacity.** |
| `PriorityBlockingQueue` | ❌ unbounded | Heap-ordered. Priority job scheduling. Doesn't preserve FIFO for equal priority. |
| `DelayQueue` | ❌ unbounded | Elements only available after their delay expires. Scheduled retries, TTL caches, timeouts. |
| `SynchronousQueue` | 0 capacity | A direct handoff — `put` blocks until a `take`. Used by `newCachedThreadPool`. |
| `LinkedTransferQueue` | ❌ unbounded | `transfer()` blocks until consumed. Fastest queue in the JDK. |
| `LinkedBlockingDeque` | Optional | Double-ended; work-stealing designs. |

> ⚠️ **The unbounded queue trap — an actual outage pattern.** `new LinkedBlockingQueue<>()` is effectively infinite. If producers outpace consumers, the queue grows until you get an `OutOfMemoryError`. **Always bound your queues.** A bounded queue turns an OOM crash into **backpressure**: `put()` blocks the producer, which naturally throttles the whole pipeline.

### Industry example: log ingestion pipeline

```java
public class LogPipeline {
    private final BlockingQueue<LogEvent> queue = new ArrayBlockingQueue<>(10_000);
    private final ExecutorService consumers = Executors.newFixedThreadPool(4);
    private volatile boolean running = true;

    public void start() {
        for (int i = 0; i < 4; i++) {
            consumers.submit(() -> {
                List<LogEvent> batch = new ArrayList<>(100);
                while (running || !queue.isEmpty()) {
                    try {
                        LogEvent e = queue.poll(200, TimeUnit.MILLISECONDS);
                        if (e != null) batch.add(e);
                        // flush when batch is full OR the poll timed out (latency bound)
                        if (batch.size() >= 100 || (e == null && !batch.isEmpty())) {
                            elasticsearch.bulkIndex(batch);   // batching = 100x fewer round trips
                            batch.clear();
                        }
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt(); break;
                    }
                }
                if (!batch.isEmpty()) elasticsearch.bulkIndex(batch);   // drain on shutdown
            });
        }
    }

    // Non-blocking producer: drop logs rather than slow down the request thread
    public void log(LogEvent e) {
        if (!queue.offer(e)) droppedCounter.increment();
    }
}
```
**The key design decision:** `offer()` (drop on overflow) vs `put()` (block the producer). For **logs**, drop — never let logging slow user requests. For **payments**, block or persist — never drop.

### `DelayQueue` — scheduled retries
```java
class RetryTask implements Delayed {
    private final long executeAt;   // System.nanoTime() + backoff
    private final Message msg;
    public long getDelay(TimeUnit u) { return u.convert(executeAt - System.nanoTime(), NANOSECONDS); }
    public int compareTo(Delayed o) { return Long.compare(getDelay(NANOSECONDS), o.getDelay(NANOSECONDS)); }
}
DelayQueue<RetryTask> retries = new DelayQueue<>();
retries.put(new RetryTask(msg, backoffFor(attempt)));
RetryTask ready = retries.take();   // blocks until something's delay expires
```

## 8.4 `CopyOnWriteArrayList` / `CopyOnWriteArraySet`

Every mutation copies the entire backing array. Reads are completely free — no locks, no volatile-read cost beyond one (they read a `volatile` array reference — F3 — and iterate the snapshot it pointed to, without ever needing mutual exclusion, since that snapshot can never change under them).

```java
private final List<EventListener> listeners = new CopyOnWriteArrayList<>();

public void fireEvent(Event e) {
    for (EventListener l : listeners) l.onEvent(e);   // ✅ never CME, never blocks, no copy
}
```

| ✅ Use when | ❌ Avoid when |
|---|---|
| Reads ≫ writes (1000:1 or more) | Any meaningful write rate |
| Small collection | Large collection (each write is O(n) copy + garbage) |
| Listener lists, config lists, routing tables | Anything data-plane sized |

Iterators are **snapshot-based**: they see the array as of iterator creation and never reflect later changes. They also don't support `remove()`.

## 8.5 The Full Map

| Single-threaded | Concurrent replacement | Ordering |
|---|---|---|
| `HashMap` | `ConcurrentHashMap` | none |
| `TreeMap` | `ConcurrentSkipListMap` | sorted, lock-free |
| `LinkedHashMap` (LRU) | ❌ no direct equivalent → use **Caffeine** or `Collections.synchronizedMap` | insertion/access |
| `ArrayList` | `CopyOnWriteArrayList` (read-heavy) | index |
| `HashSet` | `ConcurrentHashMap.newKeySet()` | none |
| `TreeSet` | `ConcurrentSkipListSet` | sorted |
| `ArrayDeque` | `ConcurrentLinkedDeque` | FIFO/LIFO |
| `LinkedList` as queue | `ConcurrentLinkedQueue` (non-blocking) or `LinkedBlockingQueue` (blocking) | FIFO |
| `PriorityQueue` | `PriorityBlockingQueue` | priority |

```java
Set<String> concurrentSet = ConcurrentHashMap.newKeySet();   // ✅ the right concurrent HashSet
```

**`ConcurrentLinkedQueue` vs `LinkedBlockingQueue`:**
- `ConcurrentLinkedQueue` — non-blocking (CAS-based, Michael-Scott algorithm — the queue analogue of 7.6's Treiber stack). `poll()` returns `null` when empty. Use when consumers have other work to do and shouldn't block.
- `LinkedBlockingQueue` — `take()` blocks. Use for dedicated consumer threads (the normal case).

---
---

# PART 9 — The Executor Framework & Thread Pools

> **If you learn one API well, make it this one.** Every backend service, every Spring app, every batch job uses it.

## 9.1 Why Not `new Thread()` Per Task?

```java
// ⛔ THE production-killer
public void handleRequest(Request req) {
    new Thread(() -> process(req)).start();
}
```

Under a traffic spike of 50,000 req/s:
1. **Creation cost** — ~50–100 µs each, plus ~1 MB stack reservation (Part F1, F5 — real OS-level work to set up a new call stack and register the thread with the scheduler). 10,000 threads ≈ 10 GB of stack address space.
2. **Unbounded resource use** — no ceiling. `OutOfMemoryError: unable to create new native thread`, then the JVM dies.
3. **Context-switch thrashing** — 10,000 threads on 8 cores means the OS spends more time switching than working (Part F5's context-switch cost, multiplied by a scheduler that now has to constantly juggle far more runnable threads than there are cores to run them on). Throughput *collapses* as load increases.
4. **No lifecycle control** — can't shut down cleanly, can't monitor, can't cancel.

**Thread pools fix all four:** reuse threads (no creation cost), cap the count (bounded resources), and give you a queue (backpressure) plus lifecycle management.

## 9.2 The Core Interfaces

```
Executor                 → void execute(Runnable)          (the minimal abstraction)
  └─ ExecutorService     → submit/invokeAll/shutdown, returns Futures
       └─ ScheduledExecutorService → schedule(), scheduleAtFixedRate()
```

```java
ExecutorService pool = Executors.newFixedThreadPool(10);

pool.execute(() -> doWork());                    // fire and forget (Runnable)
Future<String> f = pool.submit(() -> compute());  // returns a Future (Callable)

pool.shutdown();
```

## 9.3 `Future` — A Handle to a Pending Result

```java
Future<Report> future = pool.submit(() -> generateReport(id));

// do other work here — this is the point!

try {
    Report r = future.get(5, TimeUnit.SECONDS);   // ✅ ALWAYS use a timeout
} catch (TimeoutException e) {
    future.cancel(true);   // true = interrupt the running thread
    return fallbackReport();
} catch (ExecutionException e) {
    Throwable cause = e.getCause();   // ← the ACTUAL exception from your task
    log.error("Report generation failed", cause);
}
```

| Method | Notes |
|---|---|
| `get()` | ⛔ **Blocks forever.** Never use in a request path. |
| `get(t, unit)` | ✅ Always prefer this |
| `cancel(mayInterrupt)` | `false` = only cancel if not yet started; `true` = also interrupt a running task |
| `isDone()` / `isCancelled()` | Non-blocking status |

**`Future`'s limitations** (which is why `CompletableFuture` exists — Part 10):
- No way to be **notified** on completion — you must poll or block
- Can't **chain** operations
- Can't **combine** multiple futures
- No built-in exception recovery

## 9.4 The `Executors` Factory Methods — And Why to Avoid Most of Them

```java
Executors.newFixedThreadPool(n)        // n threads, UNBOUNDED LinkedBlockingQueue  ⚠️
Executors.newSingleThreadExecutor()    // 1 thread,  UNBOUNDED queue                ⚠️
Executors.newCachedThreadPool()        // UNBOUNDED threads, SynchronousQueue       ⚠️⚠️
Executors.newScheduledThreadPool(n)    // for delayed/periodic tasks
Executors.newWorkStealingPool()        // ForkJoinPool, parallelism = #cores
Executors.newVirtualThreadPerTaskExecutor()   // 🆕 Java 21
```

> ⚠️ **Google's Java style guide, Alibaba's Java rules, and most production standards all say: don't use these factories.** Two of them can OOM your service:
>
> - `newFixedThreadPool` / `newSingleThreadExecutor` → unbounded **queue**. Tasks pile up until heap OOM.
> - `newCachedThreadPool` → unbounded **thread count**. A traffic spike creates thousands of threads until native OOM.
>
> **Construct `ThreadPoolExecutor` explicitly.**

## 9.5 `ThreadPoolExecutor` — The Real Thing

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    10,                                     // corePoolSize
    50,                                     // maximumPoolSize
    60L, TimeUnit.SECONDS,                  // keepAliveTime for threads above core
    new ArrayBlockingQueue<>(1000),         // workQueue — BOUNDED
    namedThreadFactory("order-worker-%d"),  // threadFactory
    new ThreadPoolExecutor.CallerRunsPolicy() // rejection handler
);
```

### The task-submission algorithm (memorize — top interview question)

```
submit(task):
  1. Are there fewer than corePoolSize threads?
        YES → create a NEW thread for this task. done.
  2. Try to add the task to the queue.
        SUCCESS → done. (task waits)
  3. Queue is FULL. Are there fewer than maximumPoolSize threads?
        YES → create a NEW thread for this task. done.
  4. → REJECT via RejectedExecutionHandler
```

> 🎯 **The counter-intuitive consequence:** the pool **fills the queue before growing past `corePoolSize`**. So with `core=10, max=50, queue=unbounded`, you will **never** get more than 10 threads — `maximumPoolSize` is dead code. This is the #1 thread-pool misconfiguration in the wild.
>
> If you want the pool to grow under load, use a **small or zero-capacity queue** (e.g. `SynchronousQueue`).

### Rejection policies

| Policy | Behavior | When to use |
|---|---|---|
| `AbortPolicy` (default) | Throws `RejectedExecutionException` | Fail fast; caller returns 503 |
| `CallerRunsPolicy` | The **submitting thread** runs the task itself | ✅ **Best for backpressure** — slows the producer naturally |
| `DiscardPolicy` | Silently drops | Metrics, logs, telemetry (lossy is fine) |
| `DiscardOldestPolicy` | Drops the oldest queued task, retries | Real-time feeds where fresh data > old data |
| Custom | Anything | Persist to DB/Kafka, alert, apply your own fallback |

```java
// Custom: don't lose the task — persist it for later
new RejectedExecutionHandler() {
    public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
        metrics.counter("pool.rejected").increment();
        deadLetterStore.save(r);
        log.warn("Pool saturated: active={} queue={}", e.getActiveCount(), e.getQueue().size());
    }
}
```

> ❓ **"Why is `CallerRunsPolicy` so good?"** It creates a natural feedback loop. When the pool is saturated, the thread that submits (often your HTTP accept thread) is forced to do the work itself, so it stops accepting new requests for that duration. Load naturally propagates backwards to the client instead of piling up in memory. This is **backpressure** without any extra machinery.

### Sizing the pool

**CPU-bound work:**
$$N_{threads} = N_{cores} + 1$$
The `+1` keeps the CPU busy during an occasional page fault. More threads than cores just adds context switching (Part F5) without adding compute capacity — there's no more actual parallelism to extract once every core already has work queued.

**I/O-bound work:**
$$N_{threads} = N_{cores} \times U \times \left(1 + \frac{W}{C}\right)$$
where `U` = target CPU utilization (0–1), `W` = wait time, `C` = compute time.

**Worked example:** 8 cores, target 100% util, each task = 100ms waiting on an HTTP call + 5ms of CPU.
```
N = 8 × 1.0 × (1 + 100/5) = 8 × 21 = 168 threads
```
The intuition behind the formula: while any *one* task is blocked waiting on I/O (Part 0.3's "reason 2"), its thread is parked (Part F5) and consuming no CPU at all — so, in principle, you can keep `W/C` *additional* threads busy doing real compute work on the same core during that wait, before you've used up the core's actual capacity. More threads than that don't buy you anything, because the cores are already saturated with real work; fewer, and cores sit idle waiting for I/O-bound threads to wake back up.

> 🎯 **In practice, don't trust the formula — measure.** The real bound is usually a **downstream** resource: your DB has 100 connections, so more than ~100 concurrent DB workers just queues on the connection pool. **Size your thread pool to the narrowest downstream bottleneck.**

### ✅ Isolate pools by workload type (bulkhead pattern)

```java
// ⛔ ONE pool for everything: a slow report query starves the checkout path
ExecutorService everything = Executors.newFixedThreadPool(50);

// ✅ Bulkheads: a failure in one area can't consume the capacity of another
ExecutorService checkoutPool  = newPool(20, "checkout");   // critical, low latency
ExecutorService reportPool    = newPool(4,  "report");     // slow, non-critical
ExecutorService emailPool     = newPool(8,  "email");      // best-effort
```
This is the **bulkhead pattern** (ship compartments). If the reporting DB hangs, only 4 threads are stuck; checkout is unaffected. Resilience4j and Hystrix formalize this.

## 9.6 `invokeAll` and `invokeAny`

```java
List<Callable<PriceQuote>> tasks = vendors.stream()
    .map(v -> (Callable<PriceQuote>) () -> v.getQuote(item))
    .toList();

// invokeAll — waits for ALL, returns Futures in the SAME ORDER as the input
List<Future<PriceQuote>> results = pool.invokeAll(tasks, 3, TimeUnit.SECONDS);
List<PriceQuote> quotes = new ArrayList<>();
for (Future<PriceQuote> f : results) {
    if (f.isCancelled()) continue;   // timed out
    try { quotes.add(f.get()); }
    catch (ExecutionException e) { log.warn("vendor failed", e.getCause()); }
}

// invokeAny — returns the FIRST successful result, cancels the rest
String result = pool.invokeAny(redundantTasks, 2, TimeUnit.SECONDS);
```

**`invokeAll` use case:** fan-out to N services and aggregate (a product page needing 6 services).
**`invokeAny` use case:** query 3 replicas and take the fastest — **hedged requests**, a standard tail-latency reduction technique at Google/Amazon scale.

## 9.7 Shutdown — Doing It Right

```java
public void shutdownGracefully(ExecutorService pool) {
    pool.shutdown();                            // stop accepting new tasks; finish queued ones
    try {
        if (!pool.awaitTermination(30, TimeUnit.SECONDS)) {
            log.warn("Pool didn't terminate in 30s, forcing...");
            List<Runnable> dropped = pool.shutdownNow();   // interrupt running, drain queue
            log.warn("Dropped {} queued tasks", dropped.size());
            if (!pool.awaitTermination(10, TimeUnit.SECONDS)) {
                log.error("Pool did not terminate");
            }
        }
    } catch (InterruptedException e) {
        pool.shutdownNow();
        Thread.currentThread().interrupt();
    }
}
```

| Method | Effect |
|---|---|
| `shutdown()` | Refuse new tasks; **complete** queued + running ones. Non-blocking. |
| `shutdownNow()` | Refuse new tasks; **interrupt** running ones; **return** unstarted queued tasks |
| `awaitTermination(t, u)` | Block until terminated / timeout. **Required** — `shutdown()` returns immediately |
| `isShutdown()` / `isTerminated()` | Status |

> ⚠️ `shutdownNow()` only *interrupts*. If your tasks swallow `InterruptedException` (Part 1.6), they'll keep running. **Interruption handling and graceful shutdown are the same problem.**

> ⚠️ **If you never shut down a pool with non-daemon threads, your JVM will not exit.** Common cause of "my main() finished but the process hangs."

**Spring:** `@Bean(destroyMethod = "shutdown")`, or use `ThreadPoolTaskExecutor` with `setWaitForTasksToCompleteOnShutdown(true)` and `setAwaitTerminationSeconds(30)`.

## 9.8 `ScheduledExecutorService`

```java
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2, factory);

// One-shot delay
scheduler.schedule(() -> sendReminder(id), 30, TimeUnit.MINUTES);

// Fixed RATE — starts every 60s regardless of how long the task takes
scheduler.scheduleAtFixedRate(this::publishMetrics, 0, 60, TimeUnit.SECONDS);

// Fixed DELAY — waits 60s AFTER the previous run finishes
scheduler.scheduleWithFixedDelay(this::pollQueue, 0, 60, TimeUnit.SECONDS);
```

```
Task takes 90s, period 60s:

scheduleAtFixedRate:   [--90s--][--90s--][--90s--]   ← runs back-to-back, never "catches up"
                       ^0s      ^90s     ^180s        (executions can bunch up)

scheduleWithFixedDelay: [--90s--]<60s>[--90s--]<60s>  ← guaranteed gap between runs
```

| Use | Which |
|---|---|
| Heartbeat / metrics on a strict cadence | `scheduleAtFixedRate` |
| Polling / cleanup where overlap must be avoided | `scheduleWithFixedDelay` ✅ safer default |

> ⚠️ **A thrown exception permanently cancels a scheduled task — silently.** This is the classic "our nightly cleanup stopped running three months ago and nobody noticed." **Always wrap the body in try/catch:**

```java
scheduler.scheduleWithFixedDelay(() -> {
    try {
        cleanupExpiredSessions();
    } catch (Exception e) {                    // catch Exception, not just RuntimeException
        log.error("Cleanup failed, will retry next cycle", e);
    }
}, 0, 1, TimeUnit.HOURS);
```

> ⚠️ **`Timer`/`TimerTask` are obsolete.** A single thread for all tasks; one uncaught exception kills *all* scheduled tasks; sensitive to system clock changes. Use `ScheduledExecutorService`.

> 🎯 **In a multi-instance deployment, `ScheduledExecutorService` runs on every instance.** For "run this job exactly once across the cluster," you need distributed coordination — ShedLock, Quartz with a JDBC store, a Kubernetes CronJob, or a leader election. Very common SDE-2 interview follow-up.

## 9.9 The Silent Exception Trap

```java
// ⛔ This exception disappears completely
pool.submit(() -> { throw new RuntimeException("boom"); });
// No log. No stack trace. Nothing. It's stored in a Future you never read.
```

| | Exception behavior |
|---|---|
| `execute(Runnable)` | Propagates → `UncaughtExceptionHandler` fires → logged |
| `submit(...)` | **Captured into the `Future`.** Invisible unless you call `get()` |

**Fixes:**
```java
// Option 1: always handle the Future
Future<?> f = pool.submit(task);
// ...later, or in a completion callback:
try { f.get(); } catch (ExecutionException e) { log.error("task failed", e.getCause()); }

// Option 2: override afterExecute in a custom ThreadPoolExecutor
class LoggingThreadPool extends ThreadPoolExecutor {
    @Override protected void afterExecute(Runnable r, Throwable t) {
        super.afterExecute(r, t);
        if (t == null && r instanceof Future<?> f && f.isDone()) {
            try { f.get(); }
            catch (CancellationException ce) { t = ce; }
            catch (ExecutionException ee) { t = ee.getCause(); }
            catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
        }
        if (t != null) log.error("Task threw", t);
    }
}

// Option 3: wrap every task body (simplest, works everywhere)
pool.submit(() -> { try { doWork(); } catch (Exception e) { log.error("failed", e); } });

// Option 4: CompletableFuture with .exceptionally() / .whenComplete()  ← modern answer
```

## 9.10 Monitoring Your Pools

```java
// Export these as gauges. They tell you everything about your system's health.
pool.getPoolSize();            // current thread count
pool.getActiveCount();         // threads currently executing tasks
pool.getQueue().size();        // ← queue depth: the #1 saturation signal
pool.getCompletedTaskCount();
pool.getLargestPoolSize();     // high-water mark — did we ever hit max?
pool.getTaskCount();
```

**How to read them:**
- Queue depth growing steadily → **consumers can't keep up.** Scale out, or add backpressure.
- `activeCount == maxPoolSize` constantly → saturated; expect rejections.
- `largestPoolSize` never reached `max` while the queue is full → your queue is too big (see 9.5).
- High `poolSize` but low `activeCount` → threads are blocked on something (take a thread dump).

## 9.11 `ForkJoinPool` & Work Stealing

Designed for **divide-and-conquer** CPU-bound tasks that recursively split.

**Work stealing:** each worker thread has its own **deque** (a double-ended queue — push/pop from either end). It pushes/pops sub-tasks from its own head (LIFO — great cache locality, since the most recently pushed sub-task is the one most likely to still have its data warm in this core's cache, Part F2). When idle, it **steals** from the *tail* of another thread's deque (FIFO — steals the biggest, oldest chunks, minimizing how often a steal has to happen at all). Result: automatic load balancing with minimal contention — most of the time a worker is only ever touching its *own* deque, and only occasionally reaching across to someone else's.

```java
public class SumTask extends RecursiveTask<Long> {
    private static final int THRESHOLD = 10_000;
    private final long[] arr; private final int lo, hi;

    SumTask(long[] arr, int lo, int hi) { this.arr = arr; this.lo = lo; this.hi = hi; }

    @Override
    protected Long compute() {
        if (hi - lo <= THRESHOLD) {                 // small enough → do it directly
            long sum = 0;
            for (int i = lo; i < hi; i++) sum += arr[i];
            return sum;
        }
        int mid = (lo + hi) >>> 1;
        SumTask left  = new SumTask(arr, lo, mid);
        SumTask right = new SumTask(arr, mid, hi);
        left.fork();                    // ✅ submit left asynchronously
        long rightResult = right.compute();  // ✅ compute right on THIS thread (no wasted thread)
        long leftResult  = left.join();
        return leftResult + rightResult;
    }
}

long total = ForkJoinPool.commonPool().invoke(new SumTask(data, 0, data.length));
```

> 🎯 **The `fork()` / `compute()` / `join()` order matters.** Forking *both* halves and joining both wastes a thread and doubles overhead. Fork one, compute the other inline.

**Threshold tuning:** too small → task-management overhead dominates. Too large → poor parallelism. Rule of thumb: ~10,000 basic operations per leaf task.

`RecursiveTask<V>` returns a value; `RecursiveAction` returns void.

## 9.12 Parallel Streams — Convenient and Dangerous

```java
long count = orders.parallelStream().filter(Order::isPaid).count();
```

**All parallel streams share the SINGLE common `ForkJoinPool`** (`parallelism = #cores - 1`).

> ⚠️ **The catastrophic anti-pattern:**
> ```java
> // ⛔ Blocking I/O on the common pool
> urls.parallelStream().map(this::httpGet).toList();
> ```
> This occupies common-pool threads with network waits. Every *other* parallel stream in your entire JVM — including in third-party libraries — now starves. A single slow endpoint can freeze unrelated parts of your application.

**Fix — use your own pool** (works because a `ForkJoinTask` executes in the pool that invokes it):
```java
ForkJoinPool custom = new ForkJoinPool(20);
try {
    List<Response> r = custom.submit(() ->
        urls.parallelStream().map(this::httpGet).toList()
    ).get();
} finally { custom.shutdown(); }
```
**Better fix:** don't use parallel streams for I/O at all. Use `CompletableFuture` with a dedicated executor (Part 10), or virtual threads (Part 14).

### When parallel streams actually help

✅ Use when **all** of these hold:
- Large dataset (rule of thumb: N × cost-per-element ≥ ~100 µs; usually 10,000+ elements)
- CPU-bound, no I/O and no blocking
- Splittable source (`ArrayList`, arrays, `IntStream.range` — **not** `LinkedList` or `Stream.iterate`)
- Stateless, associative, side-effect-free lambdas
- The result isn't order-sensitive in a way that costs you (`forEachOrdered` kills the benefit)

❌ Avoid when: small collections, any I/O, shared mutable state, or you're inside a web request (you'd be stealing from the common pool).

```java
// ⛔ Race — ArrayList is not thread-safe
List<String> out = new ArrayList<>();
data.parallelStream().forEach(out::add);

// ✅ collect() handles the merging safely
List<String> out = data.parallelStream().map(this::transform).collect(Collectors.toList());
```

---
---

# PART 10 — `CompletableFuture` — Asynchronous Composition

## 10.1 The Problem With `Future`

```java
// ⛔ Blocking chain — a thread sits idle for the entire duration
Future<User> uf     = pool.submit(() -> userService.get(id));
User user           = uf.get();                                  // BLOCK
Future<List<Order>> of = pool.submit(() -> orderService.get(user)); 
List<Order> orders  = of.get();                                  // BLOCK
Future<Recs> rf     = pool.submit(() -> recService.get(user, orders));
Recs recs           = rf.get();                                  // BLOCK
```
You've used a thread pool but you're still fully sequential, and you're burning a thread on every `get()` — that thread is parked (Part F5), doing nothing useful, for the entire duration of each call. **`CompletableFuture` lets you describe the *pipeline* and let the runtime execute it without blocking.**

## 10.2 Creating

```java
// Async with a result (⚠️ uses common ForkJoinPool by default)
CompletableFuture<User> f = CompletableFuture.supplyAsync(() -> userService.get(id));

// ✅ ALWAYS pass your own executor in production
CompletableFuture<User> f = CompletableFuture.supplyAsync(() -> userService.get(id), ioPool);

// Async with no result
CompletableFuture<Void> v = CompletableFuture.runAsync(() -> audit.log(evt), ioPool);

// Already-completed (useful for cache hits and tests)
CompletableFuture<User> done = CompletableFuture.completedFuture(cachedUser);
CompletableFuture<User> failed = CompletableFuture.failedFuture(new NotFoundException());

// Manually completed — bridging callback-based APIs into CompletableFuture
CompletableFuture<Response> cf = new CompletableFuture<>();
legacyClient.sendAsync(req, new Callback() {
    public void onSuccess(Response r) { cf.complete(r); }
    public void onFailure(Throwable t) { cf.completeExceptionally(t); }
});
```

> ⚠️ **The `commonPool` trap again.** `supplyAsync` without an executor uses the common `ForkJoinPool` (size = cores − 1). If your task blocks on I/O, you starve every parallel stream and every other `CompletableFuture` in the JVM. **Always pass an executor for I/O work.**

## 10.3 The Method Families

Every method comes in three variants:

| Suffix | Runs on |
|---|---|
| `thenApply(fn)` | The thread that completed the previous stage (or the caller if already done) |
| `thenApplyAsync(fn)` | The common `ForkJoinPool` |
| `thenApplyAsync(fn, executor)` | ✅ **Your executor** |

### Transform: `thenApply` / `thenCompose` / `thenAccept` / `thenRun`

```java
// thenApply — map a value (T → U)
CompletableFuture<String> name = userFuture.thenApply(User::getName);

// thenCompose — flatMap: when the function ITSELF returns a CompletableFuture
CompletableFuture<List<Order>> orders =
    userFuture.thenCompose(user -> fetchOrdersAsync(user.getId()));

// ⛔ Using thenApply here gives you CompletableFuture<CompletableFuture<List<Order>>> — nested!

// thenAccept — consume, return Void
userFuture.thenAccept(u -> log.info("Loaded {}", u.getName()));

// thenRun — run something, ignoring the value
userFuture.thenRun(() -> metrics.increment("user.loaded"));
```

> 🎯 **`thenApply` vs `thenCompose` is `map` vs `flatMap`.** If your lambda returns a `CompletableFuture`, use `thenCompose`. This is the single most common `CompletableFuture` mistake.

### Combine: `thenCombine` / `allOf` / `anyOf`

```java
// thenCombine — two INDEPENDENT futures run in PARALLEL, then merge
CompletableFuture<Price>     priceF = supplyAsync(() -> priceSvc.get(sku), pool);
CompletableFuture<Inventory> invF   = supplyAsync(() -> invSvc.get(sku), pool);

CompletableFuture<ProductView> view =
    priceF.thenCombine(invF, (price, inv) -> new ProductView(sku, price, inv));
// Total latency = max(price, inventory), not the sum.
```

```java
// allOf — wait for many. NOTE: returns CompletableFuture<Void>, so you must collect results
List<CompletableFuture<Quote>> futures = vendors.stream()
    .map(v -> supplyAsync(() -> v.quote(item), pool)
                .exceptionally(ex -> Quote.unavailable(v)))   // per-vendor fallback
    .toList();

CompletableFuture<List<Quote>> all =
    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
        .thenApply(ignored -> futures.stream()
                                     .map(CompletableFuture::join)   // safe: all are done
                                     .toList());
```

```java
// anyOf — first to complete wins (used for hedged requests / fastest replica)
CompletableFuture<Object> fastest = CompletableFuture.anyOf(replica1, replica2, replica3);
```

> ⚠️ `anyOf` completes on the first result **or the first exception**. If you want "first *success*," you need `exceptionally` on each input, or write a custom combiner.

### Error handling: `exceptionally` / `handle` / `whenComplete`

```java
// exceptionally — recover from failure (only fires on error)
CompletableFuture<Price> safe = priceFuture
    .exceptionally(ex -> {
        log.warn("Price service failed, using cached", ex);
        return cachedPrice(sku);
    });

// handle — runs on BOTH success and failure, can transform
CompletableFuture<String> h = future.handle((result, ex) ->
    ex != null ? "fallback" : result.toString());

// whenComplete — side effects on both paths, does NOT change the value
future.whenComplete((result, ex) -> {
    timer.stop();
    if (ex != null) metrics.increment("failure"); else metrics.increment("success");
});

// Java 12+: separate paths
future.exceptionallyCompose(ex -> retryAsync());   // retry returning another future
```

> ⚠️ **Exceptions are wrapped in `CompletionException`.** Unwrap with `ex.getCause()` before instanceof checks:
> ```java
> .exceptionally(ex -> {
>     Throwable root = (ex instanceof CompletionException) ? ex.getCause() : ex;
>     if (root instanceof TimeoutException) return Price.unknown();
>     throw new CompletionException(root);
> })
> ```

### Timeouts (Java 9+)

```java
future.orTimeout(2, TimeUnit.SECONDS);                      // fail with TimeoutException
future.completeOnTimeout(defaultValue, 2, TimeUnit.SECONDS); // ✅ complete with a fallback
```
For Java 8, combine with a `ScheduledExecutorService` that calls `completeExceptionally`.

> ⚠️ **A timeout does NOT cancel the underlying work.** The HTTP call keeps running and keeps holding a thread. Combine with a client-level timeout (e.g. OkHttp `readTimeout`) — that's what actually frees the resource.

## 10.4 Complete Real-World Example: Product Page Aggregation

```java
@Service
public class ProductPageService {
    private final ExecutorService ioPool = new ThreadPoolExecutor(
        20, 50, 60L, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(500),
        namedFactory("product-io-%d"),
        new ThreadPoolExecutor.CallerRunsPolicy());

    public ProductPage load(String sku, String userId) {
        long start = System.nanoTime();

        // All six calls start immediately, in parallel
        var detailsF = supplyAsync(() -> catalog.getDetails(sku), ioPool)
                          .orTimeout(500, MILLISECONDS);   // CRITICAL — no fallback, must succeed

        var priceF = supplyAsync(() -> pricing.getPrice(sku, userId), ioPool)
                        .completeOnTimeout(Price.listPrice(sku), 200, MILLISECONDS)
                        .exceptionally(ex -> Price.listPrice(sku));

        var inventoryF = supplyAsync(() -> inventory.check(sku), ioPool)
                            .completeOnTimeout(Inventory.UNKNOWN, 200, MILLISECONDS)
                            .exceptionally(ex -> Inventory.UNKNOWN);

        var reviewsF = supplyAsync(() -> reviews.top(sku, 5), ioPool)
                          .completeOnTimeout(List.of(), 300, MILLISECONDS)
                          .exceptionally(ex -> List.of());   // degrade gracefully

        // recommendations DEPEND on details (category) → thenCompose
        var recsF = detailsF.thenCompose(d ->
                        supplyAsync(() -> recommender.similar(d.category(), userId), ioPool))
                    .completeOnTimeout(List.of(), 400, MILLISECONDS)
                    .exceptionally(ex -> List.of());

        ProductPage page = detailsF
            .thenCombine(priceF,     ProductPage::withPrice)
            .thenCombine(inventoryF, ProductPage::withInventory)
            .thenCombine(reviewsF,   ProductPage::withReviews)
            .thenCombine(recsF,      ProductPage::withRecommendations)
            .join();   // one single block, at the very end

        metrics.record("productpage.latency", System.nanoTime() - start);
        return page;
    }
}
```

**What this demonstrates — the core SDE-2 lessons:**
1. **Parallel fan-out** — total latency ≈ slowest call, not the sum (6×80ms = 480ms → ~90ms)
2. **Graceful degradation** — reviews fail? Show the page without reviews. Only `details` is non-negotiable.
3. **Per-call timeouts** — a hung dependency can't hang your page
4. **Dependency modeling** — `thenCompose` for the one call that needs a prior result
5. **Dedicated pool with backpressure** — not the common pool, and bounded

> ❓ **"Why not just use 6 threads and `join()` them?"** You could — and with virtual threads (Part 14) you should. But with platform threads: 6 blocked threads per request × 1000 concurrent requests = 6000 threads, each pinning ~1MB of reserved stack (Part F1) whether or not it's doing anything. `CompletableFuture` callbacks don't hold a thread while waiting on a non-blocking client — the thread is released back to the pool entirely and only a lightweight callback registration remains — so you use far fewer.

## 10.5 `CompletableFuture` Gotchas Checklist

- [ ] Always pass an explicit `Executor` for anything I/O-bound
- [ ] Use `thenCompose`, not `thenApply`, when the lambda returns a future
- [ ] `join()` throws unchecked `CompletionException`; `get()` throws checked `ExecutionException`
- [ ] Never `.get()`/`.join()` inside a stage — you'll block a pool thread and can deadlock
- [ ] Unwrap `CompletionException` before checking exception types
- [ ] Timeouts don't cancel underlying work — set client-level timeouts too
- [ ] `ThreadLocal` (including MDC logging context and `SecurityContext`) does **not** propagate across stages — see Part 12.4
- [ ] `allOf` returns `Void` — you must collect results yourself

---
---

# PART 11 — Synchronizers: Latch, Barrier, Semaphore, Phaser, Exchanger

## 11.1 `CountDownLatch` — One-Shot Gate

A counter that only goes down. Threads wait until it reaches zero. **Cannot be reset.** Like every synchronizer in this part, it's built on AQS (Part 6.6) — here, `state` simply *is* the countdown value, and `await()` parks (Part F5) until a CAS drives that `state` to zero.

```java
CountDownLatch latch = new CountDownLatch(3);
latch.countDown();   // decrement
latch.await();       // block until zero
latch.await(5, TimeUnit.SECONDS);   // ✅ with timeout
```

### Use case 1: Application startup readiness

```java
public class ServiceBootstrap {
    private final CountDownLatch ready = new CountDownLatch(3);

    public void start() throws InterruptedException {
        pool.submit(() -> { dbPool.warmUp();       ready.countDown(); });
        pool.submit(() -> { cache.preload();       ready.countDown(); });
        pool.submit(() -> { kafkaConsumer.subscribe(); ready.countDown(); });

        if (!ready.await(60, TimeUnit.SECONDS)) {
            throw new IllegalStateException("Startup timed out");
        }
        healthCheck.markReady();   // now Kubernetes readiness probe returns 200
    }
}
```
**This is exactly how a `/health/ready` endpoint should work** — don't accept traffic before dependencies are warm.

### Use case 2: The starting gate (load testing)

```java
CountDownLatch startGate = new CountDownLatch(1);      // fires the pistol
CountDownLatch finishGate = new CountDownLatch(100);   // all runners done

for (int i = 0; i < 100; i++) {
    new Thread(() -> {
        try {
            startGate.await();         // everyone waits at the line
            hammerTheEndpoint();
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        finally { finishGate.countDown(); }
    }).start();
}

long t0 = System.nanoTime();
startGate.countDown();                 // GO! — maximizes simultaneous contention
finishGate.await();
System.out.println("Elapsed: " + (System.nanoTime() - t0) / 1_000_000 + "ms");
```
**This is the standard harness for reproducing race conditions**, because it maximizes the chance of true simultaneity — releasing 100 parked threads off one CAS-driven `state` transition (rather than, say, starting them in a loop, which would spread their actual starts across however long the loop itself takes to run) gets them all racing for the shared resource within nanoseconds of each other.

> ⚠️ **Always `countDown()` in a `finally` block.** If a task throws before counting down, `await()` hangs forever.

## 11.2 `CyclicBarrier` — Reusable Rendezvous

All N threads wait until all N arrive; then all proceed. **Then it resets** and can be used again.

```java
CyclicBarrier barrier = new CyclicBarrier(4, () -> {
    // Barrier action: runs ONCE, on the LAST arriving thread, before any are released
    mergeResults();
    log.info("Iteration complete");
});

// In each of 4 worker threads:
for (int iteration = 0; iteration < 100; iteration++) {
    computeMyPartition(iteration);
    barrier.await();   // wait for all 4 to finish this iteration
}
```

**Use case: iterative simulations.** Physics/ML/grid computations where iteration N+1 needs all of iteration N's results. Each thread owns a partition; the barrier synchronizes generations.

```java
// Conway's Game of Life / cellular automaton / n-body simulation
class GridWorker implements Runnable {
    public void run() {
        while (!done) {
            for (int row = myStart; row < myEnd; row++) computeNextRow(row);
            barrier.await();       // ← wait for all workers before reading neighbors
            swapBuffers();         // (done in the barrier action, actually)
        }
    }
}
```

> ⚠️ **`BrokenBarrierException`:** if any waiting thread is interrupted or times out, the barrier is **broken** and *all* other waiters get `BrokenBarrierException`. Call `barrier.reset()` to recover. This all-or-nothing semantic is deliberate — partial progress in a barrier algorithm is usually meaningless.

| | `CountDownLatch` | `CyclicBarrier` |
|---|---|---|
| Reusable | ❌ one-shot | ✅ resets automatically |
| Who waits | Waiters ≠ counters (usually) | The parties themselves wait |
| Trigger | Counter hits 0 (via `countDown`) | N threads arrive at `await()` |
| Barrier action | ❌ | ✅ optional `Runnable` |
| Typical use | Startup, "wait for N tasks" | Iterative parallel algorithms |

## 11.3 `Semaphore` — Permit-Based Throttling

Controls how many threads may access a resource simultaneously. Where `ReentrantLock` (state = 0 or 1) models "one owner," `Semaphore`'s AQS `state` (Part 6.6) is simply the number of remaining permits — the same underlying machinery, generalized from "at most one" to "at most N."

```java
Semaphore sem = new Semaphore(10);          // 10 permits
Semaphore fair = new Semaphore(10, true);   // FIFO

sem.acquire();            // blocks until a permit is free
try { useResource(); }
finally { sem.release(); }  // ✅ ALWAYS in finally

sem.tryAcquire();                          // non-blocking
sem.tryAcquire(100, TimeUnit.MILLISECONDS); // bounded wait
sem.acquire(3);                            // multiple permits at once
sem.availablePermits();                    // ← export as a metric
```

### Use case 1: Rate-limiting an external API

```java
public class ThrottledPaymentClient {
    // Vendor contract says: max 10 concurrent connections
    private final Semaphore permits = new Semaphore(10);

    public PaymentResult charge(Payment p) throws InterruptedException {
        if (!permits.tryAcquire(2, TimeUnit.SECONDS)) {
            throw new ServiceOverloadedException("Payment gateway at capacity");
        }
        try {
            return gateway.charge(p);
        } finally {
            permits.release();
        }
    }
}
```
**Why this and not a thread pool of 10?** A thread pool couples *concurrency limit* with *thread ownership*. A semaphore limits concurrency **without owning any threads** — it works with async clients, virtual threads, and callers from any pool. It's the concurrency-limiting primitive; the pool is a threading primitive.

### Use case 2: Bounding memory-heavy work

```java
// Only 3 concurrent video transcodes — each uses 2GB RAM
private final Semaphore transcodeSlots = new Semaphore(3);
```

### Use case 3: A resource pool (this is literally how connection pools work)

```java
public class SimpleConnectionPool {
    private final Semaphore available;
    private final BlockingQueue<Connection> pool;

    public SimpleConnectionPool(int size) {
        this.available = new Semaphore(size, true);   // fair → no starvation
        this.pool = new ArrayBlockingQueue<>(size);
        for (int i = 0; i < size; i++) pool.add(createConnection());
    }

    public Connection borrow(long timeoutMs) throws InterruptedException {
        if (!available.tryAcquire(timeoutMs, TimeUnit.MILLISECONDS))
            throw new PoolExhaustedException("No connection within " + timeoutMs + "ms");
        return pool.poll();
    }

    public void giveBack(Connection c) {
        if (c == null) { available.release(); return; }
        if (isValid(c)) pool.offer(c); else pool.offer(createConnection());
        available.release();
    }
}
```

> ⚠️ **Nothing stops you from calling `release()` without `acquire()`** — permits would grow unboundedly. A semaphore is not "owned" like a lock. Always pair acquire/release with try/finally.

**`Semaphore(1)`** works as a mutex — but unlike `ReentrantLock`, it is **not reentrant** (calling `acquire()` twice self-deadlocks) and can be released by a different thread. Both are occasionally features (handoff patterns) but usually bugs.

## 11.4 `Phaser` — A Flexible Barrier (Java 7+)

`CyclicBarrier` with a **dynamic** number of parties and multiple phases.

```java
Phaser phaser = new Phaser(1);   // register self ("main")

for (Task t : tasks) {
    phaser.register();           // ✅ parties can join dynamically
    pool.submit(() -> {
        try { doPhase1(t); phaser.arriveAndAwaitAdvance();   // phase 0 → 1
              doPhase2(t); phaser.arriveAndAwaitAdvance();   // phase 1 → 2
              doPhase3(t); }
        finally { phaser.arriveAndDeregister(); }            // ✅ parties can leave
    });
}
phaser.arriveAndDeregister();    // main deregisters
```

**Use when:** the number of participants isn't known upfront or changes between phases — e.g. a multi-stage ETL where stage 2 spawns extra workers. Otherwise `CyclicBarrier` is simpler.

## 11.5 `Exchanger` — Two-Way Handoff

```java
Exchanger<Buffer> exchanger = new Exchanger<>();

// Producer thread
Buffer full = fill(emptyBuffer);
emptyBuffer = exchanger.exchange(full);   // hand off full, receive empty

// Consumer thread
Buffer empty = drain(fullBuffer);
fullBuffer = exchanger.exchange(empty);   // hand off empty, receive full
```
Niche: **buffer recycling** in high-throughput pipelines (avoids allocation churn/GC pressure). Rarely needed.

## 11.6 Choosing a Synchronizer

| I need to... | Use |
|---|---|
| Wait for N one-time events to finish | `CountDownLatch` |
| Release N threads simultaneously | `CountDownLatch(1)` as a gate |
| Sync N threads repeatedly across iterations | `CyclicBarrier` |
| Same, but party count varies | `Phaser` |
| Limit concurrent access to K | `Semaphore` |
| Pass work items between threads | `BlockingQueue` |
| Swap objects between exactly 2 threads | `Exchanger` |
| Wait for an async result | `CompletableFuture` |

---
---

# PART 12 — `ThreadLocal`

## 12.1 The Idea

A `ThreadLocal<T>` gives **each thread its own independent copy** of a variable. No sharing → no synchronization needed — this is Part 13.1's strategy #1 ("don't share state") turned into a concrete API: instead of eliminating the shared field, you eliminate the *sharing*, by giving every thread a private slot for it.

```java
private static final ThreadLocal<SimpleDateFormat> FORMATTER =
    ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd"));

public String format(Date d) {
    return FORMATTER.get().format(d);   // each thread has its own SimpleDateFormat
}
```

**Why this exists:** `SimpleDateFormat` is **not thread-safe** — it stores parsing state in instance fields. Sharing one static instance across threads silently produces wrong dates (a genuinely nasty production bug: `2024-13-45`, or an `ArrayIndexOutOfBoundsException` deep inside the JDK).

Three ways to fix it:
1. `synchronized` around every use → contention on a hot path
2. `new SimpleDateFormat()` every call → allocation churn (it's expensive to construct)
3. `ThreadLocal` → one instance per thread, zero contention ✅

> 🎯 **Modern answer:** use `java.time.DateTimeFormatter`, which **is** immutable and thread-safe. But `ThreadLocal` remains essential for the use cases below.

**Mechanically:** each `Thread` object has a `ThreadLocalMap` field — an ordinary hash map (conceptually similar to Part 8's `HashMap` internals, though purpose-built), just one that lives *inside* the `Thread` object itself rather than being a shared structure. `threadLocal.get()` looks the value up in `Thread.currentThread().threadLocals`, using the `ThreadLocal` object itself as the key. Because each thread has its own separate map, there is nothing here for two threads to contend over at all — they're not touching the same map, the same way two threads' local variables (Part F1) never touch the same stack frame.

## 12.2 The Real Industry Use Cases

### 1. Request context propagation (the #1 use)

```java
public final class RequestContext {
    private static final ThreadLocal<Context> CTX = new ThreadLocal<>();

    public static void set(Context c) { CTX.set(c); }
    public static Context get() { return CTX.get(); }
    public static void clear() { CTX.remove(); }   // ✅ CRITICAL
}

// Servlet filter / Spring interceptor
public class ContextFilter implements Filter {
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        try {
            RequestContext.set(new Context(
                req.getHeader("X-Trace-Id"),
                req.getHeader("X-Tenant-Id"),
                extractUser(req)));
            chain.doFilter(req, res);
        } finally {
            RequestContext.clear();   // ✅ MUST clear — thread goes back to the pool
        }
    }
}

// Now ANY layer, 15 frames deep, can read it without threading it through every signature:
public void saveOrder(Order o) {
    o.setTenantId(RequestContext.get().tenantId());   // no parameter plumbing
    repo.save(o);
}
```

**Why not just pass a parameter?** You'd have to add `Context ctx` to every method signature in every layer — controller → service → repository → mapper → audit → metrics. In a large codebase that's thousands of signature changes and it pollutes your domain API with infrastructure concerns.

### 2. Logging MDC (Mapped Diagnostic Context)

```java
MDC.put("traceId", traceId);       // SLF4J's MDC is a ThreadLocal<Map<String,String>>
MDC.put("userId", userId);
try { processRequest(); }
finally { MDC.clear(); }
```
Now **every** log line in that request automatically carries the trace ID — that's how you grep a single user's journey out of a million-line log file. This is the backbone of distributed tracing (OpenTelemetry, Zipkin, Jaeger).

### 3. Transaction / connection binding

Spring's `@Transactional` binds the `Connection` to the current thread via `ThreadLocal` (`TransactionSynchronizationManager`). That's why nested DAO calls automatically join the same transaction without you passing a `Connection` around.

> 🎯 **This also explains a classic Spring gotcha:** if you spawn a new thread inside a `@Transactional` method, the new thread has **no transaction** — the `ThreadLocal` doesn't follow it, precisely because a `ThreadLocal`'s whole design is a private-per-thread map (12.1), and a brand-new thread starts with a brand-new, empty `ThreadLocalMap`. Its DB writes commit independently and won't roll back with the parent. Interview gold.

### 4. `ThreadLocalRandom`

```java
int r = ThreadLocalRandom.current().nextInt(100);
```
`Math.random()` and a shared `Random` use an `AtomicLong` seed — under contention, every thread CAS-fights (Part F7) over one variable, the exact contended-CAS cost pattern Part 7.4 warned about. `ThreadLocalRandom` gives each thread its own seed, stored in that thread's own private slot, so there's nothing left to contend over at all. **Always use it in concurrent code.**

## 12.3 The Memory Leak — The Thing That Gets People Fired

```java
// ⛔ In a thread pool, threads live FOREVER. So does anything you put in their ThreadLocalMap.
public void handle(Request r) {
    USER_CACHE.set(loadHugeUserObject(r));
    process();
    // no remove() → the object stays referenced by the pool thread forever
}
```

**Mechanics:**
- `ThreadLocalMap`'s **keys** are `WeakReference<ThreadLocal>` — so if the `ThreadLocal` itself becomes unreachable, the key is collected.
- But the **values** are strong references. A stale entry (null key, live value) persists until that same `ThreadLocal` is used again on that thread and triggers cleanup — which may never happen.
- In Tomcat/Spring, pool threads live for the entire application lifetime — a thread pool's whole point (Part 9.1) is reusing the *same* OS thread, and therefore the *same* `ThreadLocalMap`, across thousands of unrelated requests. With 200 pool threads × a 5 MB cached object = **1 GB leaked**, growing until `OutOfMemoryError`.

**Worse: cross-request data leakage.** If you don't clear a `ThreadLocal<User>`, request #2 handled by the same pooled thread reads request #1's user. **You've just shown Alice's data to Bob.** This is a real, shipped class of security bug.

**Also: classloader leaks.** In an app server, a `ThreadLocal` holding an object whose class came from the webapp's classloader prevents the *entire classloader* from being GC'd on redeploy → `Metaspace` OOM after a few redeploys.

### ✅ The rule

```java
try {
    threadLocal.set(value);
    doWork();
} finally {
    threadLocal.remove();   // NOT set(null) — remove() deletes the entry
}
```

Make `ThreadLocal` fields `private static final`, and always clear in `finally`.

## 12.4 `InheritableThreadLocal` and Its Limits

```java
private static final InheritableThreadLocal<String> TRACE_ID = new InheritableThreadLocal<>();
```
Child threads **inherit** the parent's value **at creation time**.

> ⚠️ **This does NOT work with thread pools** — pool threads are created once at startup, long before your request exists. They inherit whatever was set at pool-construction time (usually nothing), forever, because "inherit at creation time" is a one-time copy performed when `new Thread()` runs, not a live link — and a pooled thread's `new Thread()` call happened once, at pool startup, not once per task.

**Solutions for propagating context to async tasks:**

```java
// Manual capture-and-restore (the pattern all frameworks use under the hood)
public static Runnable wrap(Runnable task) {
    Map<String, String> parentMdc = MDC.getCopyOfContextMap();   // capture on CALLING thread
    return () -> {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        if (parentMdc != null) MDC.setContextMap(parentMdc);      // restore on WORKER thread
        try { task.run(); }
        finally {
            MDC.clear();
            if (previous != null) MDC.setContextMap(previous);
        }
    };
}
pool.submit(wrap(() -> processAsync(order)));
```

**Off-the-shelf options:**
- Spring: `DelegatingSecurityContextExecutor`, `TaskDecorator` on `ThreadPoolTaskExecutor`
- Micrometer / OpenTelemetry: `ContextExecutorService` wrappers
- Alibaba: `TransmittableThreadLocal` (TTL) — designed exactly for pools
- 🆕 Java 21: **`ScopedValue`** (preview) — immutable, structured, works correctly with virtual threads

```java
// 🆕 ScopedValue (Java 21+ preview) — the modern replacement
private static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

ScopedValue.where(CURRENT_USER, user).run(() -> {
    handleRequest();     // CURRENT_USER.get() works here and in any structured child task
});                      // automatically unbound — no remove(), no leak possible
```

---
---

# PART 13 — Immutability, Safe Publication & Thread Confinement

> **This part is the *design* answer to concurrency.** Everything before this was mechanism; this is strategy. Interviewers at SDE-2 level care much more about this than about `wait`/`notify` syntax.

## 13.1 The Hierarchy of Thread Safety Strategies

Prefer them in this order:

```
1. Don't share state            (thread confinement, stack confinement)
2. Share immutable state        (no writes → no races, no sync needed)
3. Share thread-safe objects    (concurrent collections, atomics)
4. Guard shared mutable state   (locks) ← only when 1–3 don't work
```

Most concurrency bugs come from jumping straight to #4 without considering #1–3.

## 13.2 Immutability

An object is immutable if:
1. All fields are `final`
2. The class is `final` (or all methods are final) — so a subclass can't add mutable state
3. No setters; state never changes after construction
4. `this` doesn't escape during construction
5. **Mutable components are defensively copied** on the way in and on the way out

```java
public final class Order {
    private final String id;
    private final BigDecimal total;             // BigDecimal is itself immutable ✅
    private final List<LineItem> items;         // ⚠️ List is mutable — must protect
    private final Instant createdAt;            // Instant is immutable ✅

    public Order(String id, BigDecimal total, List<LineItem> items) {
        this.id = Objects.requireNonNull(id);
        this.total = total;
        this.items = List.copyOf(items);        // ✅ defensive copy IN (caller can't mutate later)
        this.createdAt = Instant.now();
    }

    public List<LineItem> getItems() { return items; }   // ✅ List.copyOf is unmodifiable
    // ⛔ If we had stored the caller's list directly, they could mutate our state afterwards

    // "Mutation" returns a NEW object
    public Order withDiscount(BigDecimal d) {
        return new Order(id, total.subtract(d), items);
    }
}
```

**Java 16+ `record` gives you most of this for free:**
```java
public record Order(String id, BigDecimal total, List<LineItem> items, Instant createdAt) {
    public Order {
        items = List.copyOf(items);   // compact constructor — still need the defensive copy!
    }
}
```
> ⚠️ Records are **shallowly** immutable. `record Config(Map<String,String> props)` is mutable if the caller keeps a reference to that map. Always copy in the compact constructor.

**Why immutability solves concurrency:**
- No writes after construction → **no race conditions possible.** Every failure mode in Part 2.1 — atomicity, visibility, ordering — is fundamentally about *concurrent writes*, or a write racing a read. Remove writes entirely, after construction, and there's simply nothing left for any of the three problems to apply to.
- `final` fields get the JMM's freeze guarantee (Part 2.7) → **safe publication for free**
- Can be shared freely, cached, used as map keys, passed across threads with zero synchronization

**Industry pattern — copy-on-write config:**
```java
private volatile AppConfig config;   // immutable object, volatile reference

public void reload() {
    AppConfig fresh = AppConfig.load();   // build the WHOLE new object first
    this.config = fresh;                  // single atomic reference swap
}
public AppConfig get() { return config; }
// Readers always see a complete, consistent config — never a half-updated one.
// Zero locks. Zero contention. This is how most production config systems work.
```

## 13.3 Safe Publication

**Publication** = making an object visible to other threads. **Safe** publication = other threads see it fully constructed.

### ⛔ Unsafe publication
```java
public Holder holder;
public void initialize() { holder = new Holder(42); }
```
Another thread reading `holder` may see a non-null reference to a **partially constructed** object (Part 2.8's reordering problem — the same "steps 2 and 3 can swap" hazard that broke double-checked locking). It might read `n == 0` instead of `42`, or even see the field change value on two consecutive reads.

### ✅ The five safe publication idioms

| # | Idiom | Example |
|---|---|---|
| 1 | Static initializer | `public static Holder h = new Holder(42);` |
| 2 | `volatile` field or `AtomicReference` | `private volatile Holder h;` |
| 3 | `final` field of a properly-constructed object | `this.h = new Holder(42);` in a constructor |
| 4 | Guarded by a lock (both write and read) | `synchronized` on both sides |
| 5 | Put into a thread-safe collection | `concurrentMap.put(k, holder)` — the collection guarantees it |

Every one of these five is, underneath, just another application of the two mechanisms already built up across this guide: a happens-before edge (Part 2.6) connecting the construction to the read. Idiom 1 uses the class-loading guarantee (Part 2.8's Version 5); idiom 2 uses the volatile write/read pair (rule 3); idiom 3 uses the JMM's `final`-field freeze (2.7); idiom 4 uses the monitor unlock/lock pair (rule 2); and idiom 5 works because the concurrent collection's own internal synchronization (Part 8's CAS/lock machinery) already has to establish a happens-before edge between a writer's `put` and a reader's `get` in order to be correct at all — you're piggybacking on a guarantee the collection was already required to provide.

Idiom 5 is the one people don't realize: **placing an object in a `ConcurrentHashMap`, `BlockingQueue`, or `CopyOnWriteArrayList` safely publishes it.** That's why passing objects through a `BlockingQueue` to a consumer thread just works.

### Publication requirements by object type

| Object type | Requirement |
|---|---|
| **Immutable** (all final fields) | Can be published **any** way, even unsafely ✅ |
| **Effectively immutable** (mutable class, never mutated after publication) | Must be **safely** published |
| **Mutable** | Must be safely published **and** thread-safe or lock-guarded |

## 13.4 Thread Confinement

If only one thread ever touches an object, it's automatically thread-safe.

**1. Stack confinement** — local variables are inherently confined, for the exact reason given in Part F1: each thread has its own separate call stack, so a local variable in one thread's stack frame is physically unreachable from any other thread — there's no reference to it anywhere another thread could obtain.
```java
public int process(List<Data> input) {
    Map<String,Integer> counts = new HashMap<>();   // ✅ never escapes → HashMap is fine
    for (Data d : input) counts.merge(d.key(), 1, Integer::sum);
    return counts.size();
}
// A plain HashMap in a local variable needs no synchronization. Don't reach for
// ConcurrentHashMap here — it's slower and signals a shared-state design that isn't there.
```

**2. `ThreadLocal` confinement** — Part 12.

**3. Ad-hoc / by-convention confinement** — "only the UI thread touches this." Fragile, but ubiquitous:
- **Swing/JavaFX/Android:** all UI updates must happen on the Event Dispatch Thread. That's why you call `SwingUtilities.invokeLater(...)` / `runOnUiThread(...)` — touching a widget from a background thread is undefined behavior.
- **Netty:** each channel is confined to one event-loop thread, so handler state needs no locks.
- **Node.js / Redis:** single-threaded by design — no concurrency bugs at all in application logic.

**4. Actor / single-writer model** — route all mutations of a given entity through one thread (partition by key). The Disruptor, Akka, Kafka's per-partition ordering, and LMAX's trading engine all work this way. This is a very strong SDE-2 answer to "how would you make this scale without locks?"

## 13.5 Documenting Thread Safety

State it in the Javadoc. Undocumented thread-safety assumptions are how bugs get introduced by the *next* engineer.

```java
/**
 * Thread-safe. All access to {@code cache} is guarded by {@code lock}.
 */
@ThreadSafe
public class SessionStore {
    @GuardedBy("lock") private final Map<String, Session> cache = new HashMap<>();
    private final Object lock = new Object();
}
```
`@ThreadSafe`, `@NotThreadSafe`, `@Immutable`, `@GuardedBy` come from JSR-305 (`com.google.code.findbugs:jsr305`) and are understood by static analyzers like SpotBugs and ErrorProne — they'll actually flag unguarded access.

---
---

# PART 14 — 🆕 Virtual Threads & Structured Concurrency (Java 21+)

## 14.1 The Problem Virtual Threads Solve

The **thread-per-request** model is the easiest to write and debug:
```java
// Simple, readable, debuggable — you can step through it, stack traces make sense
Response handle(Request r) {
    User u = userService.get(r.userId());        // blocks 50ms
    List<Order> o = orderService.list(u.id());   // blocks 80ms
    return render(u, o);
}
```
But platform threads are OS threads: ~1 MB stack, expensive to create, and the OS can only schedule a few thousand efficiently (Part F1, F5). So at scale we abandoned this model for **async/reactive** code (the `CompletableFuture` style of Part 10) — which is fast but:
- Stack traces are useless (the call chain is spread across callbacks)
- Debuggers can't step through it
- `ThreadLocal` (and thus MDC, security context, transactions) breaks
- The code is dramatically harder to read and reason about

**Virtual threads give you the simple blocking model *with* async-level scalability.**

## 14.2 How They Work

A **virtual thread** is a `Thread` managed by the JVM, not the OS. It runs on a small pool of **carrier** (platform) threads.

The magic: **when a virtual thread blocks on I/O, the JVM unmounts it from its carrier thread and parks it on the heap.** The carrier immediately picks up another virtual thread. When the I/O completes, the virtual thread is remounted (possibly on a different carrier).

Recall from Part F1 that what actually makes a "thread" is its call stack plus its program counter — a platform thread's stack is a fixed block the *OS* allocates, which is exactly why it's expensive and capped in count. A virtual thread's stack, instead, is a small, resizable *object living on the Java heap* (Part F2), managed by the JVM's own memory allocator rather than the OS — cheap to create (no syscall, F5), cheap to hold in large numbers (heap objects, not reserved OS address space), and — critically — the JVM can **copy it off the carrier thread's real stack and stash it on the heap** the moment the virtual thread would otherwise block, exactly the way an OS would save a thread's register state during a context switch (F5), except performed entirely in user-mode JVM code, without ever asking the kernel to do anything. This is why a "blocked" virtual thread costs nothing but a small heap object rather than an idle OS thread — there's no OS-level thread underneath it at all while it's unmounted.

```
Platform threads:  1000 concurrent requests = 1000 OS threads = ~1 GB stacks, OS thrashing
Virtual threads:   1,000,000 concurrent requests = ~8 OS carriers + 1M cheap heap objects
```

| | Platform thread | Virtual thread |
|---|---|---|
| Stack | ~1 MB, fixed, OS-allocated | Few hundred bytes, grows on the heap |
| Creation | ~50–100 µs | ~1 µs |
| Max practical count | ~5,000–10,000 | **Millions** |
| Blocking cost | Blocks an OS thread | Frees the carrier ✅ |
| Scheduler | OS kernel | JVM (a `ForkJoinPool`) |
| Pooling needed? | Yes | **No — never pool them** |

## 14.3 Using Them

```java
// Create one
Thread.startVirtualThread(() -> handleRequest(req));

// Builder form
Thread t = Thread.ofVirtual().name("handler-", 0).unstarted(task);

// ✅ The idiomatic way — an executor that makes a NEW virtual thread per task
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request r : requests) {
        executor.submit(() -> handle(r));      // 100,000 tasks? Fine.
    }
}   // close() waits for all tasks — ExecutorService is AutoCloseable in Java 19+
```

**Rewriting the product page (compare with Part 10.4!):**
```java
public ProductPage load(String sku, String userId) throws Exception {
    try (var scope = Executors.newVirtualThreadPerTaskExecutor()) {
        Future<Details>   d = scope.submit(() -> catalog.getDetails(sku));
        Future<Price>     p = scope.submit(() -> pricing.getPrice(sku, userId));
        Future<Inventory> i = scope.submit(() -> inventory.check(sku));
        Future<List<Review>> r = scope.submit(() -> reviews.top(sku, 5));

        return new ProductPage(d.get(), p.get(), i.get(), r.get());
        //  ↑ Plain blocking calls. Runs fully in parallel. Readable stack traces.
    }
}
```
No `thenCombine`, no `thenCompose`, no `CompletionException` unwrapping. **This is the point.**

## 14.4 The Rules That Change

> ⚠️ **1. Never pool virtual threads.** Pooling exists to amortize expensive thread creation (Part F1/F5's genuine OS-level cost). Virtual threads are cheap for exactly the reason 14.2 explained — no OS thread creation, no reserved stack. `newFixedThreadPool` of virtual threads defeats the entire purpose. Use `newVirtualThreadPerTaskExecutor()`.

> ⚠️ **2. Thread pool size is no longer your concurrency limiter.** With platform threads, a pool of 20 implicitly limited concurrent DB calls to 20. With unlimited virtual threads, you'll open 10,000 DB connections and kill your database. **Use a `Semaphore` for explicit rate limiting** (Part 11.3). This is the biggest migration gotcha.

```java
private final Semaphore dbLimit = new Semaphore(50);   // explicit, intentional

Object query() throws InterruptedException {
    dbLimit.acquire();
    try { return jdbc.query(sql); }
    finally { dbLimit.release(); }
}
```

> ⚠️ **3. Pinning.** A virtual thread **cannot unmount** while inside a `synchronized` block or a native (JNI) frame. It **pins** its carrier thread. If many virtual threads block on I/O inside `synchronized`, you exhaust carriers and throughput collapses. This is a direct consequence of Part F6/Part 3's monitor mechanics: the JVM's built-in monitor implementation was written assuming a lock's owner is a genuine OS thread with a fixed identity throughout the critical section, and unmounting the virtual thread mid-lock (moving its stack off the carrier) would break that assumption — so, rather than risk it, the JVM simply refuses to unmount at all while inside `synchronized`, at the cost of tying up a real carrier for the duration.
> - **Fix:** replace `synchronized` with `ReentrantLock` in code that blocks on I/O. `ReentrantLock` is virtual-thread-aware and unmounts correctly, because it's ordinary Java code built on AQS (Part 6.6) rather than a JVM-native monitor, and the JVM's virtual-thread runtime knows how to suspend and resume it safely.
> - Detect with: `-Djdk.tracePinnedThreads=full`
> - *(JDK 24 largely eliminated `synchronized` pinning via JEP 491 — but check your target JDK.)*

> ⚠️ **4. `ThreadLocal` still works but is discouraged.** A million virtual threads × a `ThreadLocal` value = a lot of heap (Part 12.1's per-thread map, multiplied by a million cheap threads instead of thousands of expensive ones). Prefer `ScopedValue` (Part 12.4).

> ⚠️ **5. Virtual threads don't help CPU-bound work.** They solve *blocking*, not computation — the unmount trick in 14.2 only has anything to gain from when a thread would otherwise sit idle waiting on I/O (Part F5); a thread that's genuinely computing has no idle time to reclaim. For CPU-bound parallelism you still want ~N-cores platform threads / `ForkJoinPool`.

### When to use which

| Workload | Use |
|---|---|
| I/O-bound, thread-per-request (web servers, API gateways, DB-heavy services) | ✅ **Virtual threads** |
| CPU-bound parallel computation | Platform threads / `ForkJoinPool` |
| Existing reactive codebase that works | Leave it — no need to rewrite |
| New I/O-heavy service on Java 21+ | Virtual threads over reactive |

**Framework support:** Spring Boot 3.2+ (`spring.threads.virtual.enabled=true`), Tomcat 10.1+, Jetty 12, Helidon Nima, Quarkus.

## 14.5 Structured Concurrency (Java 21 preview / 25 finalizing)

The problem: with raw executors, if the parent task is cancelled, child tasks keep running (thread leak). And if one child fails, the others waste resources finishing work nobody wants.

**Structured concurrency:** a task's subtasks must complete before the enclosing scope exits — just like a block scope in normal code. This maps the parent/child relationship of concurrent tasks onto the same call-stack-nesting idea from Part F1: just as a method's local variables are guaranteed to be gone once the method returns, a `StructuredTaskScope`'s subtasks are guaranteed to be gone once the scope's `try`-with-resources block exits.

```java
// ShutdownOnFailure: if ANY subtask fails, cancel all the others immediately
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Supplier<User>  user  = scope.fork(() -> userService.get(id));
    Supplier<Order> order = scope.fork(() -> orderService.get(id));

    scope.join();              // wait for all
    scope.throwIfFailed();     // propagate the first failure

    return new Result(user.get(), order.get());
}   // ✅ scope exit GUARANTEES no subtask is still running — no leaks

// ShutdownOnSuccess: first successful result wins, cancel the rest (hedged requests)
try (var scope = new StructuredTaskScope.ShutdownOnSuccess<String>()) {
    scope.fork(() -> queryReplica1());
    scope.fork(() -> queryReplica2());
    scope.fork(() -> queryReplica3());
    scope.join();
    return scope.result();     // the fastest one
}
```

**What you gain:**
- **No thread leaks** — the scope is a hard boundary
- **Automatic cancellation propagation** — one failure cancels siblings, saving resources
- **Observable structure** — thread dumps show the parent/child tree, not a flat sea of pool threads
- **Error handling that composes** like ordinary try/catch

> 🎯 **The takeaway for interviews:** virtual threads + structured concurrency make Java's concurrency model look like Go's goroutines — cheap threads with blocking code — but with better error handling and observability.

---
---

# PART 15 — Performance: Contention, Context Switching, False Sharing

## 15.1 The Real Costs (approximate, modern x86)

| Operation | Cost |
|---|---|
| L1 cache hit | ~1 ns |
| L2 cache hit | ~4 ns |
| Main memory access | ~100 ns |
| Uncontended lock (`synchronized` / CAS) | ~20 ns |
| **Contended lock (park/unpark)** | **~1–10 µs** (50–500x worse) |
| Context switch | ~1–10 µs + cold caches afterward |
| Thread creation (platform) | ~50–100 µs |
| Thread creation (virtual) | ~1 µs |

This table is Part F2 and F5, in numbers. The first three rows are the memory hierarchy directly — the whole reason caches exist is that the gap between row 1 and row 3 is roughly 100×. The uncontended-lock row is Part F6's mark-word CAS: cheap because it never leaves the hardware-only realm from Part F7. The contended-lock and context-switch rows are both really the *same* underlying cost — a syscall-based park/unpark round trip through the OS scheduler (Part F5) — which is why they're the same order of magnitude and why both are roughly 1000× the cost of an uncontended lock.

> 🎯 **The headline:** an uncontended lock is nearly free. **Contention is what costs you** — because it turns a 20ns operation into a scheduler round-trip plus a cold cache.

## 15.2 Reducing Contention — The Four Techniques

**1. Reduce lock duration** — the cheapest, most effective win.
```java
// ⛔ 200ms critical section
synchronized (lock) { Data d = fetchFromDb(); cache.put(k, d); }

// ✅ ~1µs critical section
Data d = fetchFromDb();
synchronized (lock) { cache.put(k, d); }
```

**2. Reduce lock granularity** — split one lock into many (lock striping, Part 3.4).

**3. Replace exclusive locks** — `ReadWriteLock`, atomics, `LongAdder`, concurrent collections.

**4. Eliminate shared state entirely** — thread confinement, immutability, per-thread accumulation then merge.
```java
// Per-thread accumulation — zero contention during the hot loop
data.parallelStream()
    .collect(Collectors.groupingByConcurrent(Order::region, Collectors.counting()));
```

## 15.3 False Sharing — The Invisible Performance Killer

CPUs transfer memory in **64-byte cache lines**, not individual variables (Part F2). If two threads write to *different* variables that happen to sit in the *same* cache line, every write invalidates the other core's copy — because the cache-coherence protocol (Part F2's MESI mention) operates at the granularity of a whole line, it cannot tell "these two threads are touching genuinely different data" from "these two threads are touching the same data"; all it can see is that the line changed. You get all the cost of sharing with none of the sharing.

```java
// ⛔ counters[0] and counters[1] are 8 bytes apart — SAME cache line
class Counters {
    volatile long a;   // Thread 1 writes this
    volatile long b;   // Thread 2 writes this
}
// Result: cache-line ping-pong. Can be 10x slower than if they were far apart.
```

**Fix 1: padding**
```java
class PaddedCounter {
    volatile long value;
    long p1, p2, p3, p4, p5, p6, p7;   // 56 bytes of padding → own cache line
}
```
The arithmetic: `value` is 8 bytes; adding 7 more 8-byte fields (56 bytes) brings the object to 64 bytes total — exactly one cache line — guaranteeing that whatever sits immediately after this object in memory starts on a *new* line, so no neighbor's writes can ever land in the same line as `value`.

**Fix 2: `@Contended` (Java 8+)**
```java
@jdk.internal.vm.annotation.Contended   // requires -XX:-RestrictContended
class Counter { volatile long value; }
```

**Where the JDK already does this for you:** `LongAdder`'s internal `Cell` class is `@Contended` — this is the exact mechanism Part 7.4 referenced when it said `LongAdder`'s cells avoid contention "thanks to internal padding." `ForkJoinPool`'s work queues are padded. Netty, Disruptor, and Agrona pad aggressively. **You rarely need to do this yourself** — but knowing it exists explains "why is my array of counters so slow?"

**Diagnose with:** `perf c2c` on Linux, or JMH's `-prof perfnorm`.

## 15.4 Choosing Concurrency Level

```
Too few threads   → idle CPUs, unused capacity
Right             → peak throughput
Too many          → context-switch thrashing, memory pressure, LOWER throughput
```
Throughput vs thread count is an **inverted U**. Past the peak, adding threads makes things *worse* — every additional thread past the point of full core utilization only adds more context-switch overhead (Part F5) and more cache pollution (Part F2) without adding any compute capacity nothing was already using. Always load-test to find your peak instead of guessing.

## 15.5 Benchmarking with JMH

**Never microbenchmark with `System.currentTimeMillis()` in a loop.** JIT warmup, dead-code elimination, constant folding, and on-stack replacement will make your numbers meaningless (often off by 100x) — all four of these are the JIT compiler (Part F4) doing exactly what it's designed to do: a "hot" loop with no observable side effects can legally be optimized away almost entirely once the compiler proves nothing outside the loop depends on the intermediate results, which is precisely the situation a naive timing loop creates.

```java
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.SECONDS)
@State(Scope.Benchmark)
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
@Fork(2)
public class CounterBenchmark {
    AtomicLong atomic = new AtomicLong();
    LongAdder adder = new LongAdder();

    @Benchmark @Threads(16)
    public void atomicLong() { atomic.incrementAndGet(); }

    @Benchmark @Threads(16)
    public void longAdder()  { adder.increment(); }
}
// Typical 16-thread result: LongAdder ~8x the throughput of AtomicLong.
```

## 15.6 Other Performance Notes

- **Prefer `ThreadLocalRandom` over `Random`** in concurrent code (Part 12.2).
- **Avoid `volatile` on hot write paths** if plain writes + a single fence at the end suffice — every `volatile` write pays for a store barrier (Part F3), whether or not it was actually contended.
- **Batch, don't chat** — one `bulkIndex(1000)` beats 1000 `index()` calls, and reduces lock/network round-trips (Part 8.3).
- **Beware `String.intern()` and `synchronized` on interned strings** — JVM-wide contention (the same shared-object trap as Part 3.2's warning against locking on string literals).
- **GC pressure is a concurrency issue** — allocating inside a hot parallel loop causes TLAB churn and GC pauses that look like lock contention. Profile with async-profiler.

---
---

# PART 16 — Debugging & Testing Concurrent Code

## 16.1 Thread Dumps — Your #1 Tool

```bash
jps -l                     # find the PID
jstack <pid> > dump.txt    # take a dump
kill -3 <pid>              # alternative (writes to stdout)
jcmd <pid> Thread.print    # modern equivalent
```

**Take 3 dumps ~5 seconds apart.** If a thread is in the same place in all three, it's genuinely stuck (not just momentarily sampled).

### Reading a dump

```
"order-worker-3" #42 prio=5 os_prio=0 tid=0x... nid=0x1a3f waiting for monitor entry
   java.lang.Thread.State: BLOCKED (on object monitor)
        at com.example.OrderService.process(OrderService.java:88)
        - waiting to lock <0x000000076ab62208> (a java.lang.Object)
        - locked <0x000000076ab62190> (a com.example.Inventory)
```

A thread dump is really a snapshot of every thread's call stack (Part F1) at one instant, plus the JMM-level state (Part 1.2) of what each one is doing — which is exactly why it's such a powerful tool: it's the closest you can get to seeing every thread's stack frame simultaneously, something no debugger lets you do live across a whole fleet of threads at once.

**The decoder:**

| You see | It means | Likely cause |
|---|---|---|
| Many `BLOCKED` on the same monitor address | Lock contention | Critical section too long / too coarse |
| Many `WAITING` on `getConnection` | Connection pool exhausted | Leaked connections, slow queries, pool too small |
| Many `TIMED_WAITING` on `park` in a pool | Idle workers | Normal — pool is under-utilized |
| `RUNNABLE` at `socketRead0` | Blocked on network I/O | ⚠️ Counts as RUNNABLE! No timeout set? |
| `Found one Java-level deadlock` | Deadlock | Fix your lock ordering |
| Thousands of threads | Unbounded thread creation | `newCachedThreadPool` or `new Thread()` per request |

> 🎯 **`RUNNABLE` at `socketRead0` is the classic misdiagnosis.** The JVM can't tell that a native socket read is blocking (it's a JNI call into OS networking code, outside the JVM's own thread-state bookkeeping from Part 1.2), so it reports `RUNNABLE`. If you see 200 threads "RUNNABLE" but 2% CPU, they're all waiting on the network. **Root cause: a missing socket read timeout.**

### Tools
- **Visual analyzers:** FastThread.io, IBM TMDA, JProfiler, YourKit
- **Live profiling:** async-profiler (`-e lock` for lock contention), Java Flight Recorder / JDK Mission Control
- **JFR for locks:** `jcmd <pid> JFR.start settings=profile duration=60s filename=rec.jfr` — then look at the "Java Monitor Blocked" and "Thread Park" events

```java
// Programmatic — great for a /debug/threads admin endpoint
ThreadMXBean mx = ManagementFactory.getThreadMXBean();
mx.setThreadContentionMonitoringEnabled(true);
for (ThreadInfo ti : mx.dumpAllThreads(true, true)) {
    log.info("{} state={} blockedCount={} blockedTime={}ms waitedTime={}ms",
        ti.getThreadName(), ti.getThreadState(),
        ti.getBlockedCount(), ti.getBlockedTime(), ti.getWaitedTime());
}
```

## 16.2 Why Concurrency Bugs Are Hard

- **Non-deterministic** — a race may fire 1 time in 10 million, because it depends on the precise, essentially-random timing of OS scheduling decisions (Part F5) that vary run to run
- **Heisenbugs** — adding a log statement changes the timing and the bug disappears (a log call itself takes time and often involves I/O and locks, which shifts exactly the interleaving that was triggering the race)
- **Environment-sensitive** — your 4-core laptop with a debugger attached behaves differently from a 64-core production box (more cores means more genuine parallelism, Part 0.2, and different, often much tighter, timing windows for a race to fire in)
- **Load-dependent** — many races only appear at high concurrency

## 16.3 Testing Strategies

**1. Maximize contention with a starting gate**
```java
@Test
void concurrentIncrementsAreNotLost() throws Exception {
    Counter counter = new Counter();
    int threads = 50, iterations = 10_000;
    CountDownLatch start = new CountDownLatch(1);
    CountDownLatch done  = new CountDownLatch(threads);
    ExecutorService pool = Executors.newFixedThreadPool(threads);
    AtomicReference<Throwable> error = new AtomicReference<>();

    for (int i = 0; i < threads; i++) {
        pool.submit(() -> {
            try {
                start.await();                                    // all threads fire at once
                for (int j = 0; j < iterations; j++) counter.increment();
            } catch (Throwable t) { error.set(t); }
            finally { done.countDown(); }
        });
    }
    start.countDown();
    assertTrue(done.await(30, TimeUnit.SECONDS), "test timed out — possible deadlock");
    pool.shutdownNow();

    assertNull(error.get());
    assertEquals(threads * (long) iterations, counter.get());
}
```

**2. Run repeatedly** — `@RepeatedTest(1000)` (JUnit 5). Races need many attempts.

**3. Vary the environment** — run tests on a machine with a different core count; use `-XX:+UnlockDiagnosticVMOptions -XX:+StressLCM -XX:+StressGCM` to encourage aggressive reordering (Part 2.5) — these flags deliberately push the JIT toward the most adversarial legal instruction orderings, on the theory that a race that only manifests under rare reorderings is still a real bug worth finding in CI rather than in production.

**4. Use purpose-built tools**
- **jcstress** — the OpenJDK harness for JMM/concurrency correctness. The gold standard.
- **Thread Weaver / MultithreadedTC** — deterministic interleaving control
- **ErrorProne / SpotBugs** — static detection of `@GuardedBy` violations, unsynchronized lazy init, `ConcurrentModification` risks
- **Lincheck** (JetBrains) — model checking for linearizability (a formal correctness property: the concurrent structure must behave *as if* every operation took effect atomically at some single point between its call and return — a precise, checkable version of the informal "atomic" from Part F7)

**5. Assert timeouts** — a hanging test *is* a failing test.
```java
assertTimeoutPreemptively(Duration.ofSeconds(5), () -> service.process());
```

**6. Make tests deterministic where you can**
```java
// ⛔ Flaky: depends on wall-clock timing
Thread.sleep(100);
assertEquals(5, service.getCount());

// ✅ Deterministic: wait for the actual signal
assertTrue(completionLatch.await(5, TimeUnit.SECONDS));
assertEquals(5, service.getCount());
```

**7. Use `Awaitility` for async assertions**
```java
await().atMost(5, SECONDS).untilAsserted(() -> assertEquals(100, queue.processedCount()));
```

## 16.4 Production Monitoring Checklist

Export these as metrics for every service:

- [ ] Thread pool: `activeCount`, `poolSize`, `queueSize`, `completedTaskCount`, rejection count
- [ ] Connection pool: active, idle, pending, wait time percentiles
- [ ] JVM: total thread count, deadlocked thread count (via `ThreadMXBean`)
- [ ] Per-operation latency **percentiles** (p50/p95/p99) — averages hide contention entirely
- [ ] Lock wait time (JFR or `ThreadMXBean` contention monitoring)

**Alert on:** queue depth trending up, rejection count > 0, deadlocked threads > 0, thread count growing unboundedly, p99 latency diverging from p50 (the classic contention signature).

---
---

# PART 17 — Real-World System Designs

## 17.1 Token Bucket Rate Limiter

```java
public class TokenBucketRateLimiter {
    private final long capacity;
    private final double refillPerNano;
    private double tokens;
    private long lastRefillNanos;
    private final ReentrantLock lock = new ReentrantLock();

    public TokenBucketRateLimiter(long capacity, long tokensPerSecond) {
        this.capacity = capacity;
        this.refillPerNano = tokensPerSecond / 1_000_000_000.0;
        this.tokens = capacity;
        this.lastRefillNanos = System.nanoTime();
    }

    public boolean tryAcquire(int permits) {
        lock.lock();
        try {
            refill();
            if (tokens >= permits) { tokens -= permits; return true; }
            return false;
        } finally { lock.unlock(); }
    }

    private void refill() {
        long now = System.nanoTime();
        tokens = Math.min(capacity, tokens + (now - lastRefillNanos) * refillPerNano);
        lastRefillNanos = now;
    }
}
```
**Design notes:** the bucket allows short bursts up to `capacity` (which is usually what you want — real traffic is bursty), while enforcing a long-run average rate. Use `System.nanoTime()`, **never** `currentTimeMillis()` — the latter jumps with NTP adjustments and can make your limiter grant infinite tokens or freeze.
**In production:** Resilience4j `RateLimiter`, Guava `RateLimiter`, or Redis + Lua for distributed limiting (a JVM-local limiter doesn't work across replicas).

## 17.2 Thread-Safe TTL Cache with Single-Flight Loading

```java
public class TtlCache<K, V> {
    private record Entry<V>(V value, long expiresAtNanos) {
        boolean expired() { return System.nanoTime() > expiresAtNanos; }
    }

    private final ConcurrentHashMap<K, CompletableFuture<Entry<V>>> map = new ConcurrentHashMap<>();
    private final Function<K, V> loader;
    private final long ttlNanos;
    private final ScheduledExecutorService sweeper =
        Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "cache-sweeper"); t.setDaemon(true); return t;
        });

    public TtlCache(Function<K, V> loader, Duration ttl, ExecutorService loadPool) {
        this.loader = loader;
        this.ttlNanos = ttl.toNanos();
        sweeper.scheduleWithFixedDelay(this::evictExpired, 1, 1, TimeUnit.MINUTES);
    }

    public V get(K key) {
        while (true) {
            CompletableFuture<Entry<V>> f = map.computeIfAbsent(key, this::load);
            Entry<V> e = f.join();
            if (!e.expired()) return e.value();
            map.remove(key, f);   // atomic: only removes if it's still THIS future
        }
    }

    private CompletableFuture<Entry<V>> load(K key) {
        // Fast: computeIfAbsent only holds the bin lock long enough to insert the future.
        // The ACTUAL loading happens outside, asynchronously.
        return CompletableFuture.supplyAsync(
            () -> new Entry<>(loader.apply(key), System.nanoTime() + ttlNanos));
    }

    private void evictExpired() {
        map.forEach((k, f) -> {
            if (f.isDone() && !f.isCompletedExceptionally() && f.join().expired())
                map.remove(k, f);
        });
    }
}
```
**Key properties** — this design is a compact showcase of nearly every mechanism this guide has built up:
- **Single-flight / stampede protection** — 1000 concurrent misses on the same key trigger **one** load (Part 8.2's memoizer pattern). Everyone else waits on the same `CompletableFuture`.
- **Short lock hold** — storing a `Future` rather than a value means `computeIfAbsent` doesn't hold a bin lock during the slow load (Part 8.2's gotcha, Part 3.4's "never hold a lock across I/O" rule).
- **Conditional removal** — `map.remove(key, f)` prevents evicting a *newer* entry another thread just inserted (the same CAS-style conditional-update idea from Part 7.3).

> 🎯 **In production, use Caffeine.** It does all of this plus W-TinyLFU eviction, refresh-ahead, and async loading. Write this only in interviews.

## 17.3 Bounded Work Queue With Graceful Shutdown

```java
public class OrderProcessor implements AutoCloseable {
    private final BlockingQueue<Order> queue = new ArrayBlockingQueue<>(5_000);
    private final ExecutorService workers;
    private final AtomicBoolean accepting = new AtomicBoolean(true);
    private final CountDownLatch drained;

    public OrderProcessor(int workerCount) {
        this.drained = new CountDownLatch(workerCount);
        this.workers = Executors.newFixedThreadPool(workerCount, namedFactory("order-%d"));
        for (int i = 0; i < workerCount; i++) workers.submit(this::workLoop);
    }

    /** Returns false if the system is saturated — caller should return HTTP 429/503. */
    public boolean submit(Order o) {
        if (!accepting.get()) throw new IllegalStateException("shutting down");
        return queue.offer(o);   // ✅ non-blocking, gives us backpressure signalling
    }

    private void workLoop() {
        try {
            while (accepting.get() || !queue.isEmpty()) {
                Order o = queue.poll(500, TimeUnit.MILLISECONDS);
                if (o == null) continue;
                try { process(o); }
                catch (Exception e) { log.error("Failed order {}", o.id(), e); dlq.send(o); }
                //     ^^^ CRITICAL: one bad order must never kill the worker loop
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            drained.countDown();
        }
    }

    @Override
    public void close() throws InterruptedException {
        accepting.set(false);                         // 1. stop accepting
        if (!drained.await(30, TimeUnit.SECONDS)) {   // 2. let workers drain the queue
            log.warn("Drain timed out; {} orders remain", queue.size());
        }
        workers.shutdownNow();                        // 3. force stop
        workers.awaitTermination(10, TimeUnit.SECONDS);
    }
}
```
**The three lessons here:** bounded queue = backpressure (Part 8.3); per-item try/catch = a poison message can't kill your worker (Part 5.5's livelock-avoidance lesson, applied to exceptions instead of retries); a two-phase shutdown (stop accepting → drain → force) = no lost work during a Kubernetes rolling deploy (Part 9.7's graceful-shutdown pattern).

## 17.4 Circuit Breaker

```java
public class CircuitBreaker {
    enum State { CLOSED, OPEN, HALF_OPEN }

    private final AtomicReference<State> state = new AtomicReference<>(State.CLOSED);
    private final AtomicInteger failures = new AtomicInteger();
    private final AtomicInteger halfOpenProbes = new AtomicInteger();
    private volatile long openedAtNanos;

    private final int threshold = 5;
    private final long resetAfterNanos = TimeUnit.SECONDS.toNanos(30);

    public <T> T call(Supplier<T> action, Supplier<T> fallback) {
        State s = state.get();

        if (s == State.OPEN) {
            if (System.nanoTime() - openedAtNanos < resetAfterNanos) return fallback.get();
            // Try to transition to HALF_OPEN — exactly ONE thread wins the CAS
            if (!state.compareAndSet(State.OPEN, State.HALF_OPEN)) return fallback.get();
            halfOpenProbes.set(0);
        }

        if (state.get() == State.HALF_OPEN && halfOpenProbes.incrementAndGet() > 1) {
            return fallback.get();   // only let ONE probe request through
        }

        try {
            T result = action.get();
            onSuccess();
            return result;
        } catch (Exception e) {
            onFailure();
            return fallback.get();
        }
    }

    private void onSuccess() { failures.set(0); state.set(State.CLOSED); }

    private void onFailure() {
        if (failures.incrementAndGet() >= threshold) {
            openedAtNanos = System.nanoTime();
            state.set(State.OPEN);
        }
    }
}
```
**Why CAS matters here:** without `compareAndSet` on the OPEN→HALF_OPEN transition, 500 threads would all decide to probe simultaneously and re-kill the recovering service — the exact same "everyone independently decides they're the one who should act" race Part 2.2's check-then-act example warned about, here at the scale of an entire fleet of request threads instead of two. The CAS (Part F7/Part 7.2) ensures exactly one probe, by making the state transition itself the single point of truth every thread must contend for, rather than letting every thread reach its own conclusion from a stale read.
**In production:** Resilience4j.

## 17.5 Parallel Batch Processing With Partial Failure Handling

```java
public BatchResult processAll(List<Record> records, int parallelism) throws InterruptedException {
    ExecutorService pool = Executors.newFixedThreadPool(parallelism, namedFactory("batch-%d"));
    try {
        List<Callable<Outcome>> tasks = records.stream()
            .map(r -> (Callable<Outcome>) () -> {
                try { return Outcome.success(r.id(), process(r)); }
                catch (Exception e) { return Outcome.failure(r.id(), e); }
                //  ^^^ Catch INSIDE the task so one failure doesn't abort the batch
            })
            .toList();

        List<Future<Outcome>> futures = pool.invokeAll(tasks, 10, TimeUnit.MINUTES);

        List<Outcome> succeeded = new ArrayList<>(), failed = new ArrayList<>();
        for (Future<Outcome> f : futures) {
            if (f.isCancelled()) { failed.add(Outcome.timedOut()); continue; }
            try {
                Outcome o = f.get();
                (o.isSuccess() ? succeeded : failed).add(o);
            } catch (ExecutionException e) { failed.add(Outcome.failure(null, e.getCause())); }
        }
        return new BatchResult(succeeded, failed);
    } finally {
        shutdownGracefully(pool);
    }
}
```
**Design decision:** catch exceptions *inside* each task and return an `Outcome` rather than throwing. This turns "the whole batch died on record 4,782" into "9,998 succeeded, 2 failed, here's why." That's almost always the right behavior for ETL and bulk imports.

---
---

## 17.6 Framework-Level Concurrency (Spring / Servlet / JPA)

Most of your day-to-day concurrency is *implicit*, hidden inside a framework. Knowing where the threads come from is what separates SDE 1 from SDE 2.

### Your Spring beans are singletons shared by every request thread

```java
@Service
public class OrderService {
    private int counter = 0;              // ⛔ SHARED MUTABLE STATE across all requests
    private Order currentOrder;           // ⛔ request #2 overwrites request #1's data

    public void process(Order o) {
        this.currentOrder = o;            // ☠️ data leaking between users
        counter++;                        // ☠️ lost updates
    }
}
```
Tomcat runs ~200 request threads against **one** instance of this bean — a single shared heap object (Part F2), so every one of those 200 threads is reading and writing the exact same `counter` and `currentOrder` fields, exactly the setup Part 2.1's three failure modes describe.

**The rule: Spring beans (`@Service`, `@Component`, `@Repository`, `@Controller`) must be stateless.** Keep per-request data in method parameters and local variables (stack confinement, Part 13.4). If you need shared state, use `AtomicLong`, `ConcurrentHashMap`, or an explicitly-guarded field — and say so in the Javadoc.

```java
@Service
public class OrderService {
    private final AtomicLong processed = new AtomicLong();   // ✅ intentional, thread-safe

    public Receipt process(Order o) {          // ✅ `o` is confined to this call stack
        Receipt r = doWork(o);
        processed.incrementAndGet();
        return r;
    }
}
```
> ⚠️ Same applies to Servlets (one instance, many threads), Struts actions, and JAX-RS singleton resources. `@Scope("request")` or `@Scope("prototype")` avoids it, but at the cost of proxying overhead — statelessness is the better default.

### `@Async`

```java
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {
    @Bean("emailExecutor")
    public Executor emailExecutor() {
        ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
        ex.setCorePoolSize(4);
        ex.setMaxPoolSize(8);
        ex.setQueueCapacity(500);                    // ✅ bounded
        ex.setThreadNamePrefix("email-");            // ✅ named
        ex.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        ex.setWaitForTasksToCompleteOnShutdown(true);// ✅ graceful shutdown
        ex.setAwaitTerminationSeconds(30);
        ex.initialize();
        return ex;
    }
}

@Async("emailExecutor")
public CompletableFuture<Void> sendWelcomeEmail(User u) { ... }
```

**`@Async` gotchas (all extremely common bugs):**
- ⚠️ **Self-invocation doesn't work.** Calling `this.asyncMethod()` from another method in the same class bypasses the Spring proxy and runs **synchronously**. Call it from a different bean.
- ⚠️ **The default executor is `SimpleAsyncTaskExecutor`, which creates a NEW THREAD PER CALL and is unbounded.** Always define your own.
- ⚠️ **`@Async` + `@Transactional` don't compose.** The async thread has no transaction (`ThreadLocal`, Part 12.2). Annotate the async method itself with `@Transactional` if it needs one — and know it's a *different* transaction that won't roll back with the caller.
- ⚠️ `void` return = fire-and-forget with **silently swallowed exceptions**. Return `CompletableFuture<T>`, or register an `AsyncUncaughtExceptionHandler`.
- ⚠️ MDC/trace ID/`SecurityContext` don't propagate — use a `TaskDecorator` (Part 12.4).

### The transaction boundary is a concurrency boundary

```java
// ⛔ Race: two concurrent requests both read stock=1 and both decrement
@Transactional
public void reserve(String sku) {
    Item i = repo.findBySku(sku);      // reads stock = 1
    i.setStock(i.getStock() - 1);      // both write stock = 0; two customers, one item
}
```
A JVM lock **does not help** — you have 5 pods, each its own separate process (Part 0.1's "process" row: separate, isolated address spaces), so a lock in one JVM's memory is completely invisible to the other four. The fix is at the database:
```java
// Pessimistic: SELECT ... FOR UPDATE (row lock held for the transaction)
@Lock(LockModeType.PESSIMISTIC_WRITE)
Optional<Item> findBySku(String sku);

// Optimistic: @Version column → OptimisticLockException on conflict → retry
@Version private long version;

// Or push it into the DB entirely — atomic and contention-free:
@Modifying
@Query("UPDATE Item i SET i.stock = i.stock - 1 WHERE i.sku = :sku AND i.stock > 0")
int decrementIfAvailable(@Param("sku") String sku);   // returns 0 → out of stock
```

> 🎯 **The distributed-systems lesson:** `synchronized`, `ReentrantLock`, and `AtomicInteger` protect **one JVM**. The moment you run two replicas, you need database constraints, a distributed lock (Redis Redlock, ZooKeeper, etcd), or — best — an idempotent design that doesn't need a lock at all.

### Connection pools are semaphores in disguise

HikariCP's `maximumPoolSize` is the real concurrency limit of most services — it's a `Semaphore` (Part 11.3) in every way that matters: a fixed number of permits, `acquire()`-then-`release()` around each use, threads blocking when it's exhausted. If it's 20, then 200 request threads means 180 of them are queued in `getConnection()`. **A thread pool bigger than your connection pool just moves the queue.** Size them together, and always set `connectionTimeout` so a saturated pool returns an error instead of hanging forever.

---
---

# PART 18 — Cheat Sheets, Decision Trees & Interview Prep

## 18.1 The Master Decision Tree

```
Do I have shared mutable state?
├─ NO  → 🎉 Nothing to do. (Stack confinement, immutable objects, ThreadLocal)
│
└─ YES → Can I make it immutable?
    ├─ YES → Use `final` fields + a `volatile` reference for atomic swaps. DONE.
    │
    └─ NO  → Is it a collection?
        ├─ YES → Map?    → ConcurrentHashMap
        │        Queue?  → ArrayBlockingQueue (bounded!) / ConcurrentLinkedQueue
        │        List?   → CopyOnWriteArrayList (read-heavy) / synchronized wrapper
        │        Sorted? → ConcurrentSkipListMap/Set
        │
        └─ NO  → Is it a single value?
            ├─ Just a flag / reference swap?     → volatile
            ├─ Counter, high write rate?         → LongAdder
            ├─ Counter or CAS needed?            → AtomicInteger/Long/Reference
            │
            └─ Multiple variables that must change together (an invariant)?
                ├─ Need timeout / interruptibility / multiple conditions / fairness?
                │       → ReentrantLock (+ Condition)
                ├─ Reads ≫ writes AND reads are non-trivial?
                │       → ReentrantReadWriteLock (or StampedLock if measured hot)
                └─ Otherwise → synchronized  ✅ (simplest, auto-released, JIT-optimized)
```

This tree is, top to bottom, the priority order from Part 13.1's "hierarchy of thread safety strategies" (don't share → share immutable → share thread-safe → guard with a lock), spelled out into concrete class choices. Every branch you take further down the tree is one more of the four strategies you've decided you can't get away with using.

## 18.2 Executor Decision Tree

```
What kind of work?
├─ CPU-bound, recursively splittable  → ForkJoinPool / parallel streams
├─ CPU-bound, independent tasks       → fixed pool, size = cores + 1
├─ I/O-bound
│   ├─ Java 21+ available?            → virtual threads + Semaphore for limits ✅
│   └─ Java 8–17                      → ThreadPoolExecutor sized by the formula,
│                                        or CompletableFuture with a dedicated pool
├─ Scheduled / periodic               → ScheduledExecutorService (never Timer)
│                                        (multi-instance? → ShedLock / Quartz / K8s CronJob)
└─ Async pipeline with dependencies   → CompletableFuture (or StructuredTaskScope on 21+)
```

## 18.3 The Anti-Pattern Blacklist

| ⛔ Never | ✅ Instead |
|---|---|
| `Thread.stop()` / `suspend()` / `resume()` | Interruption + a `volatile` flag |
| Swallow `InterruptedException` | Rethrow, or `Thread.currentThread().interrupt()` |
| `new Thread()` per request | A thread pool (or virtual threads) |
| `Executors.newCachedThreadPool()` in prod | Explicit `ThreadPoolExecutor` with bounds |
| Unbounded queue (`new LinkedBlockingQueue<>()`) | Bounded queue + rejection policy |
| `Future.get()` with no timeout | `get(timeout, unit)` |
| I/O or alien calls inside a lock | Copy state, release, then call out |
| `if (cond) wait()` | `while (cond) wait()` |
| `notify()` with heterogeneous waiters | `notifyAll()` or separate `Condition`s |
| Double-checked locking without `volatile` | `volatile`, or the holder idiom |
| `ThreadLocal` without `remove()` | try/finally `remove()` |
| `Hashtable` / `Vector` / `synchronizedMap` | `ConcurrentHashMap` |
| `synchronized("literal")` / on `Integer` | A `private final Object` lock |
| Parallel streams for blocking I/O | Dedicated pool / `CompletableFuture` / virtual threads |
| `lock.lock()` without `finally { unlock(); }` | The mandatory try/finally idiom |
| Pooling virtual threads | `newVirtualThreadPerTaskExecutor()` |
| Sizing pools by guesswork | Load test; size to the downstream bottleneck |

## 18.4 Rapid-Fire Interview Q&A

**Q: `synchronized` vs `volatile`?**
`volatile` = visibility + ordering only, no blocking, no mutual exclusion, no atomicity for compound ops. `synchronized` = all of that plus mutual exclusion. Use `volatile` for a flag or a reference swap; `synchronized` when an invariant spans multiple operations.

**Q: Why is `count++` unsafe even with `volatile`?**
It's read-modify-write — three operations. `volatile` makes each read and each write atomic and visible, but another thread can interleave between them. Use `AtomicInteger`.

**Q: What is happens-before?**
An ordering guarantee: if A happens-before B, A's memory effects are visible to B. Established by program order, monitor lock/unlock, volatile write/read, `Thread.start`, `Thread.join`, and transitivity. Without a happens-before edge, the JMM gives you no visibility guarantee at all.

**Q: `wait()` vs `sleep()`?**
`wait()` is on `Object`, releases the monitor, must be inside `synchronized`, wakes on notify/timeout. `sleep()` is static on `Thread`, holds all locks, just pauses.

**Q: Why must `wait()` be in a `while` loop?**
Spurious wakeups, `notifyAll` waking multiple waiters for one resource, and barging threads that consume the condition before the waiter reacquires the lock. The condition must be re-verified.

**Q: How does `ConcurrentHashMap` achieve thread safety?**
Java 8+: CAS for empty-bin insertion, `synchronized` on the first node of a non-empty bin, lock-free volatile reads, treeification of long bins, and cooperative concurrent resizing. Concurrency ≈ bucket count, not a fixed 16 segments (that was Java 7).

**Q: How does a thread pool decide to create a thread?**
Core threads first → then queue → then up to max → then reject. Consequence: with an unbounded queue, `maximumPoolSize` is never reached.

**Q: Difference between `submit()` and `execute()`?**
`execute` takes a `Runnable`, returns void, and lets exceptions reach the `UncaughtExceptionHandler`. `submit` takes `Runnable` or `Callable`, returns a `Future`, and **captures** exceptions into that `Future` — invisible unless you call `get()`.

**Q: `CountDownLatch` vs `CyclicBarrier`?**
Latch is one-shot and counted down by (usually) other threads. Barrier is reusable and the parties themselves wait for each other. Barrier supports a barrier action.

**Q: How do you prevent deadlock?**
Global lock ordering (break circular wait), `tryLock` with timeout (break hold-and-wait), never hold locks across I/O or alien calls, don't submit dependent tasks to the same bounded pool, and prefer coarse locks or lock-free structures.

**Q: What's a race condition vs a data race?**
A **data race** is two threads accessing the same location, at least one writing, with no happens-before edge — undefined behavior per the JMM. A **race condition** is a correctness bug caused by timing (e.g. check-then-act) — it can exist even in fully synchronized code if your critical sections are drawn wrong.

**Q: `AtomicInteger` vs `LongAdder`?**
`AtomicInteger` = one variable, exact reads, supports CAS, but degrades under high contention. `LongAdder` = internal striped cells, far higher write throughput, `sum()` is approximate under concurrent writes, no CAS.

**Q: What is the ABA problem?**
A CAS succeeds because the value returned to its original, hiding intervening changes. Fix with `AtomicStampedReference` (version counter) — analogous to `@Version` optimistic locking in JPA.

**Q: Why is `String` immutable, and how does that help concurrency?**
Its `final char[]`/byte[] and final fields mean it can be shared across threads with no synchronization (JMM final-field guarantee), safely cached (the string pool), and safely used as a `HashMap` key.

**Q: How do virtual threads change thread pool sizing?**
They mostly eliminate it — you create one per task. But because pools were also acting as an implicit concurrency limiter, you must now add an explicit `Semaphore` to protect downstream resources like your DB.

**Q: What is thread pinning?**
A virtual thread inside a `synchronized` block or native frame can't unmount from its carrier. If it then blocks on I/O, it holds an OS thread hostage. Fix: use `ReentrantLock` instead of `synchronized` around blocking calls.

**Q: Is `HashMap` really dangerous in a multithreaded program?**
Yes. Beyond lost updates, concurrent resize in Java 7 could create a circular linked list, making `get()` spin forever at 100% CPU. Java 8 changed the resize algorithm so the infinite loop is gone, but data loss and corrupted state remain. Use `ConcurrentHashMap`.

**Q: Can you make a singleton thread-safe without `synchronized`?**
Yes — an `enum`, or the initialization-on-demand holder idiom, both of which rely on the JVM's guaranteed thread-safe class initialization.

## 18.5 Study Order & Practice Projects

**Learning order for an SDE 1 → SDE 2 ramp:**
1. Part F, then Parts 0–1 (hardware/OS foundations, threads, lifecycle, interruption) — one to two days
2. **Part 2 (JMM)** — spend real time here; re-read it. Everything else builds on it
3. Parts 3–5 (synchronized, wait/notify, deadlock) — classic interview territory
4. **Parts 8–9 (concurrent collections, executors)** — what you'll write daily
5. Parts 6–7 (explicit locks, atomics) — the "when synchronized isn't enough" toolkit
6. Part 10 (`CompletableFuture`) — essential for microservices
7. Parts 11–13 (synchronizers, `ThreadLocal`, design) — the SDE-2 differentiators
8. Part 14 (virtual threads) — the future, and increasingly the present
9. Parts 15–17 (performance, debugging, designs) — senior-level depth

**Build these to actually internalize it:**
1. A bounded blocking queue from scratch with `wait`/`notify`, then with `Condition`
2. A thread pool from scratch (`BlockingQueue` + N worker threads + shutdown)
3. A concurrent LRU cache with TTL and single-flight loading
4. A web crawler: bounded queue, N workers, `ConcurrentHashMap` for visited URLs, graceful shutdown
5. A token bucket rate limiter, then load-test it with a `CountDownLatch` gate
6. Deliberately write a deadlock, reproduce it, then find it with `jstack`
7. Benchmark `synchronized` vs `AtomicLong` vs `LongAdder` at 1/4/16/64 threads with JMH

## 18.6 Further Reading

- **Java Concurrency in Practice** — Goetz et al. Still the definitive book, despite predating Java 8.
- **The Art of Multiprocessor Programming** — Herlihy & Shavit. Theory, lock-free algorithms.
- **Java Language Specification, Chapter 17** — the actual JMM rules.
- **JEP 444** (Virtual Threads), **JEP 453** (Structured Concurrency), **JEP 446** (Scoped Values).
- **Doug Lea's papers** — he wrote `java.util.concurrent`; the AQS paper is excellent.
- **jcstress** — run the samples to *see* the JMM misbehave on your own hardware.

---

## Final Word

The three ideas to carry with you:

1. **Concurrency bugs are visibility and ordering bugs as often as they are atomicity bugs.** If you only think about "two threads incrementing," you'll miss most of them. Learn happens-before.
2. **The best concurrency is the concurrency you avoid.** Immutability, confinement, and the right concurrent collection eliminate whole classes of bugs. Locks are a last resort, not a first one.
3. **Bound everything.** Bounded queues, bounded pools, timeouts on every blocking call, and a rejection policy. Unbounded resources don't fail gracefully — they fail as an OOM at 3 AM.
