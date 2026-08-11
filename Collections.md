# The Java Collections Framework — A Complete Working Guide (Expanded Edition)

**Who this is for:** someone new to Java who needs to reach SDE-1 / SDE-2 competence — meaning you can not only *use* collections, but *defend your choice* in a code review or an interview.

**What's different in this edition:** the original guide covered every topic an interviewer might ask about, but moved fast — it used terms like "amortised," "red-black tree," "CAS," "bitwise AND," and "lambda" as if you already knew them, because in a normal software-engineering context you usually would. This edition doesn't assume that. A new **Chunk F — Foundations** comes first and teaches the underlying computer-science vocabulary from scratch: what Big-O actually measures, how memory is laid out, what a hash function is, how binary and bitwise operators work, what a balanced tree guarantees and why, and what a race condition physically is. Every later chunk's theory section has also been rewritten to explain its *reasoning*, not just state its facts — so instead of "HashMap resizes at 0.75 load factor," you'll get the full chain: what problem resizing solves, why 0.75 specifically, what happens if you get it wrong, and how to verify the claim yourself.

Nothing has been removed. Every code sample, real-world example, and "why not just" objection from the original is still here, and the interview question bank at the end is untouched. This edition is strictly additive: more reasoning, more worked examples, more plain-English restatements — the goal is that you can read this document start to finish without opening a browser tab.

**How to read this:** each chunk is a self-contained lesson. Every chunk follows the same shape:

1. **The problem** — what goes wrong without this tool
2. **The concept** — how it actually works, including internals, explained from first principles
3. **Code** — runnable, commented
4. **Real-world use case** — where this shows up in production systems
5. **"Why not just…?"** — the objections you'll actually face, answered

Read Chunk F first, even if you're tempted to skip to "the real stuff." Every later chunk leans on it.

---

## Table of Contents

| # | Chunk | Why it matters |
|---|-------|----------------|
| F | Foundations — Big-O, Memory, Hashing, Trees, Bits, Concurrency, Generics, Lambdas | The vocabulary everything else assumes |
| 0 | Why Collections Exist At All | Foundation |
| 1 | The Framework Map (Interfaces & Hierarchy) | Mental model |
| 2 | Generics for Collections (incl. PECS) | Type safety |
| 3 | `equals()` and `hashCode()` — The Contract | Everything hash-based depends on it |
| 4 | `Comparable` vs `Comparator` — Ordering | Everything sorted depends on it |
| 5 | Iteration, `Iterator`, and `ConcurrentModificationException` | #1 beginner bug |
| 6 | `List` — ArrayList, LinkedList, Vector, Stack | Most-used interface |
| 7 | `Set` — HashSet, LinkedHashSet, TreeSet, EnumSet | Uniqueness |
| 8 | `Map` — HashMap internals, LinkedHashMap, TreeMap, EnumMap, WeakHashMap | Most-used class |
| 9 | Modern `Map` API — computeIfAbsent, merge, getOrDefault | Cleaner, atomic-friendly code |
| 10 | `Queue` & `Deque` — ArrayDeque, PriorityQueue | Schedulers, BFS, task pipelines |
| 11 | Immutable & Unmodifiable Collections | API safety |
| 12 | `Collections` and `Arrays` Utility Classes | The toolbox |
| 13 | Concurrent Collections | Multi-threaded services |
| 14 | Collections + Streams (Collectors) | Modern data transformation |
| 15 | Sequenced Collections (Java 21) | Newest addition |
| 16 | Performance, Memory & Big-O Cheat Sheet | Interview gold |
| 17 | Traps, Pitfalls & Production Bugs | Hard-won lessons |
| 18 | Choosing the Right Collection — Decision Guide | The payoff |
| 19 | Interview Question Bank with Answers | Practice |

---
---

# Chunk F — Foundations: The Vocabulary Everything Else Assumes

Every one of the later chunks uses a handful of computer-science ideas as building blocks, the way a recipe assumes you know what "simmer" means. This chunk teaches those building blocks once, in one place, so nothing downstream has to stop and explain itself. Skim it if you already know it; read it slowly if any heading looks unfamiliar. It will pay for itself within the first three chunks.

## F1. Big-O notation — what it actually measures

When we say an operation is "O(1)" or "O(n)," we are describing **how the amount of work grows as the amount of data grows** — not how fast the operation is in absolute terms. This distinction matters enormously and is worth sitting with.

Imagine you have a phone book (a stack of paper) and you want to find "Priya Sharma."

- **O(1) — constant time.** The work does *not* depend on how big the phone book is. Looking up a word in a dictionary using a perfect index card system that tells you exactly which page to open to is O(1): whether the dictionary has 100 words or 100,000, one lookup in the index gets you the page. `array[5]` is O(1) — the computer calculates the exact memory address of slot 5 directly, with no searching, regardless of whether the array holds 10 elements or 10 million.
- **O(n) — linear time.** The work grows in direct proportion to the data size. Flipping through the phone book page by page, checking each name, is O(n): double the phone book, double the worst-case number of pages you check. `list.contains(x)` on an `ArrayList` is O(n) — in the worst case, the computer checks every single element before it can say "not found."
- **O(log n) — logarithmic time.** The work grows, but *much* more slowly than the data — every time the data doubles, the work only grows by one step. This is what happens when you can **discard half the remaining possibilities at each step**. A phone book sorted alphabetically lets you do this: open to the middle, see you overshot ("Sharma" comes before what's on this page), flip to the middle of the *first half*, and repeat. A phone book with a million names takes at most about 20 comparisons this way (2²⁰ ≈ 1,000,000), not a million. `TreeMap.get()` is O(log n) for exactly this reason — the underlying tree structure (F6, below) lets each comparison eliminate half the remaining candidates.
- **O(n log n) — linearithmic time.** What you get from "do a logarithmic amount of work, once per element." This is the cost of comparison-based sorting: for each of n elements, you do roughly log n work to find its place. `Collections.sort()` is O(n log n).
- **O(n²) — quadratic time.** Work grows with the *square* of the data. This usually comes from "for every element, do an O(n) operation" — a loop inside a loop, or a `remove(0)` inside a loop over the whole list (each `remove(0)` is itself O(n), and you do it n times). At small sizes this looks fine; at 10,000 elements it can mean 100,000,000 operations, and at 100,000 elements it's 10,000,000,000 — the kind of bug that passes every test on a laptop and then falls over in production the day real traffic arrives.

**Big-O describes the worst case (usually) as data size approaches infinity, and it deliberately ignores constant factors.** "O(1)" doesn't mean "instant" — a single O(1) hash lookup that has to compute a cryptographic hash of a 10MB string is still O(1) in the collections sense (the cost doesn't grow with the *number of entries* in the map) but is far slower in real time than an O(1) array index. Big-O tells you how a cost **scales**; it does not tell you the actual number of nanoseconds. Chunk 16 comes back to this distinction with real measurements — profiling and Big-O answer different questions, and you need both.

**Why this matters for collections specifically:** almost every design decision in this guide — "use a `HashSet` instead of a `List` for membership tests," "use `ArrayDeque` instead of `ArrayList.remove(0)`" — is a Big-O decision. The two options often do the exact same *thing*; they just do it at wildly different scale-cost. A junior engineer who doesn't reason in Big-O will write code that is correct in a 20-row test fixture and catastrophic against a real 2-million-row table.

### Amortised cost — the asterisk you'll see next to `ArrayList.add()`

You'll see `ArrayList.add()` described as "O(1) amortised." Here's what that word is doing.

An `ArrayList` is backed by a fixed-size array. Most of the time, adding an element is a genuine O(1) operation: write the value into the next free slot, increment a counter. But every so often — when the array is full — it has to **grow**: allocate a brand-new, bigger array, and copy every existing element into it, which is an O(n) operation for that one call.

If you called `add()` a million times, you'd expect the *average* cost per call to be dragged up by these occasional O(n) copies. Amortised analysis is the technique of spreading that occasional expensive cost evenly across all the cheap calls that came before it, and it works out because the array grows **geometrically** (in this case, ×1.5 each time — see Chunk 6) rather than by a fixed amount. Growing geometrically means the *total* copying work across all resizes, summed from the first resize to the millionth element, is proportional to the final size — not to the final size times the number of resizes. Do the arithmetic: capacities go 10, 15, 22, 33, 50… roughly a geometric sequence; the sum of a geometric sequence is dominated by its last term, so total copying work across the whole history is O(n), spread over n calls — O(1) per call *on average*, even though any *individual* call might be the expensive one. That's what "amortised" means: not "always fast," but "fast on average across a long sequence, even though occasional calls are slow."

Contrast this with growing by a **fixed** amount (say, always +1 slot): then you'd resize (and copy everything) on *every single* `add()`, and the true cost would be O(n) per call, O(n²) overall. Geometric growth is the whole trick.

## F2. Memory: the stack, the heap, and what a "reference" really is

Java code manipulates two kinds of memory, and confusing them is the source of a huge fraction of "why did my object change when I didn't touch it?" bugs.

- **The stack** holds local variables and method call frames. It's small, fast, and strictly scoped — when a method returns, its stack frame is popped and gone. Primitives (`int`, `long`, `double`, `boolean`, etc.) live directly on the stack when they're local variables.
- **The heap** is where every object you create with `new` actually lives — `new ArrayList<>()`, `new User("alice")`, `new int[100]`. It's a large shared pool of memory managed by the garbage collector, and objects there live until nothing refers to them anymore.

Here's the part that trips people up: **a variable that holds an object never holds the object itself — it holds a *reference*, which is really just the memory address of where the object lives on the heap.** When you write:

```java
List<String> a = new ArrayList<>();
List<String> b = a;
```

`a` and `b` are two separate variables, but both hold the *same address*. There is exactly **one** `ArrayList` on the heap. `b.add("x")` and `a.get(0)` both see `"x"`, because `a` and `b` are two labels pointing at the identical object — like two people holding the same piece of paper, not two photocopies.

This is why Java is often described as **"pass references by value."** When you pass an object to a method, Java copies the *reference* (the address) — not the object. The method gets its own variable holding the same address, so:

```java
void addItem(List<String> list) { list.add("z"); }   // mutates the SHARED object — visible to the caller
void reassign(List<String> list) { list = new ArrayList<>(); }  // only rebinds the LOCAL copy of the reference — invisible to the caller
```

`addItem` mutates the object everyone points at, so the caller sees the change. `reassign` only changes what the *local variable* `list` points to — the caller's variable is untouched, because only the address was copied, and reassigning a copy of an address doesn't move the original.

**Why this matters for collections, concretely:**

- `final List<String> x = new ArrayList<>();` makes the *variable* `x` unable to be reassigned to a different list — but `x.add(...)` still works fine, because you're mutating the object `x` points to, not reassigning `x`. This is the entire explanation behind "why does `public static final Set<String> S = new HashSet<>()` not actually protect `S` from being cleared?" (Chunk 11, Chunk 17 #14) — `final` locks the *reference*, not the *contents*.
- Returning an internal list from a getter (`return this.items;`) hands the caller the *actual object*, not a copy — so `caller.getItems().clear()` really does empty your internal state. This is why Chunk 11 spends so much time on `List.copyOf()` versus `Collections.unmodifiableList()`: only a genuine **copy** creates a second, independent object on the heap.
- A `HashMap`/`HashSet` key that gets mutated *after* insertion (Chunk 3's "mutable-key catastrophe") is the same idea from a different angle: the object on the heap changed, but the map had already filed a reference to it under its *old* hash value, and there's only ever one object — so the map's internal bookkeeping and the object's current state fall out of sync.

## F3. Arrays vs. linked structures — the memory-layout reason `ArrayList` usually wins

An **array** is a single, contiguous block of memory: if element 0 lives at address 1000 and each element is 8 bytes, element 1 is at exactly 1008, element 2 at 1016, and so on. This is *why* `array[i]` is O(1) — the address is just `base + i × elementSize`, a single multiplication and addition, no searching required.

A **linked list** is the opposite: each element (a "node") is a separate, independently-allocated object on the heap, wherever the allocator happened to put it, and each node stores a pointer to the *next* node's address (and, for a doubly-linked list, the *previous* node's too). To reach element 5, you must start at the first node and follow four `next` pointers, one hop at a time — there's no formula for "where is element 5," only a chain you must walk. That's why `LinkedList.get(5)` is O(n): the only way to get there is to walk there.

This also explains a performance gap that pure Big-O hides. Modern CPUs are dramatically faster at reading memory that's *physically close together* (this is called **cache locality** — the CPU pulls a whole chunk of nearby memory into a fast on-chip cache every time it reads anything, betting that you'll want the neighbors next). Walking an array sequentially is almost always a cache hit. Walking a linked list jumps to essentially random heap addresses, node by node, and each jump is very likely a **cache miss**, which can be 10–50× slower than a cache hit even though both are technically "O(1) per step." This is the real, physical reason Chunk 6 says `ArrayList` beats `LinkedList` in nearly every practical scenario, even in big-O-tied cases — the constant factor difference is not academic, it's measured in real milliseconds.

## F4. Hashing — what a hash function and a "bucket" actually are

A **hash function** takes an input of arbitrary size (a `String`, a `User` object, anything) and deterministically produces a fixed-size number — in Java, an `int`, via `hashCode()`. "Deterministic" is the key property: the *same* input must always produce the *same* number, every time, forever (as long as the object doesn't change — see F2 above). Beyond that, a *good* hash function scatters different inputs across the full range of possible numbers as evenly and unpredictably as possible, so that unrelated inputs rarely produce the same output by coincidence.

Why do we want this? Because a hash lets you convert "is this value in my collection?" from a *search* problem into an *arithmetic* problem. Here's the mechanism, in miniature:

Imagine you have 16 empty buckets, numbered 0–15 — literally just 16 slots you can drop things into. To store `"alice"`, you compute `hash("alice")`, squeeze that number down to fit in the range 0–15 (typically with `hash % 16`, or the equivalent-but-faster bitwise trick in F5), and drop `"alice"` into that numbered bucket. To check whether `"alice"` is present later, you don't search all 16 buckets — you recompute the *same* hash, land on the *same* bucket number, and look **only there**. If the bucket's empty, you know immediately the value isn't in the collection at all, with zero comparisons against other elements.

This is the entire mechanism behind `HashMap` and `HashSet` being O(1) on average: the hash tells you exactly which tiny slice of the whole collection to examine, so you never have to scan the rest. Chunk 8 walks through the *exact* bucket-index arithmetic `HashMap` uses.

**Collisions.** Sometimes two different values hash to the same bucket — with 16 buckets and more than 16 possible values (which is every realistic case), this is mathematically guaranteed to happen eventually (a **pigeonhole principle** argument: more items than boxes means some box holds more than one). A hash table has to have a plan for this. The classic plan — **separate chaining** — is to let each bucket hold a small list of everything that landed there, and fall back to checking each one with `equals()` when a bucket has more than one occupant. This is exactly why `HashMap` needs **both** `hashCode()` (to find the bucket) **and** `equals()` (to pick the right entry within that bucket, in case of a collision) — see Chunk 3.

## F5. Binary numbers and bitwise operators

Computers store every number in **binary** — base 2, using only the digits 0 and 1, where each position represents a power of two instead of a power of ten. The number 13 in binary is `1101`, meaning `1×8 + 1×4 + 0×2 + 1×1 = 13`. Java's `int` is 32 of these binary digits ("bits") wide.

**Bitwise operators** work on these binary digits directly, position by position, rather than treating the number as a single quantity. The ones this guide uses:

| Operator | Name | What it does, bit by bit | Tiny example |
|---|---|---|---|
| `&` | AND | Result bit is 1 only if **both** input bits are 1 | `0110 & 0011 = 0010` (6 & 3 = 2) |
| `\|` | OR | Result bit is 1 if **either** input bit is 1 | `0110 \| 0011 = 0111` (6 \| 3 = 7) |
| `^` | XOR (exclusive or) | Result bit is 1 if the input bits **differ** | `0110 ^ 0011 = 0101` (6 ^ 3 = 5) |
| `<<` | left shift | Slide every bit left by n positions, filling with 0s (≈ multiply by 2ⁿ) | `0011 << 1 = 0110` (3 << 1 = 6) |
| `>>>` | unsigned right shift | Slide every bit right by n positions, filling with 0s from the top | `1000 >>> 1 = 0100` |

Two specific uses show up constantly in this guide:

**`h & (n - 1)` as a fast substitute for `h % n`, when `n` is a power of two.** If `n` is 16 (`10000` in binary), then `n - 1` is 15 (`01111`) — a run of 1s exactly as wide as the numbers below 16. ANDing any number with `01111` keeps only its lowest 4 bits, which is *exactly* the same result as `h % 16` — but a single AND instruction is far cheaper for the CPU than a division. This is why `HashMap`'s internal array size is always forced to be a power of two (Chunk 8): it's what makes this shortcut valid. The tradeoff, explained in Chunk 8, is that this shortcut only looks at the *low* bits of the hash, which motivates the next point.

**`h ^ (h >>> 16)` as a cheap way to "spread" a hash's high bits down into its low bits.** Because bucket selection (above) only looks at an int's low bits, two keys whose hashes are identical in their low 4 bits but differ only in high bits would collide constantly, even though their *full* hash values are quite different — a lot of potentially-useful randomness in the high bits would simply be thrown away. `h >>> 16` slides the top half of the number down into the bottom half; XOR-ing that with the original number mixes a bit of the high-bit information into the low bits that actually get used, without the cost of a full re-hash. You don't need to be able to derive this yourself — you need to recognize it on sight as "cheap hash-quality improvement," which is exactly what Chunk 8's `HashMap.put()` walkthrough will ask you to do.

## F6. Trees: binary search trees, balance, and what "red-black tree" means

A **tree**, in the data-structure sense, is a set of nodes connected so that each node has one parent (except a single root, which has none) and zero or more children, with no cycles. A **binary tree** restricts each node to at most two children, conventionally called *left* and *right*.

A **binary search tree (BST)** adds one ordering rule: for every node, everything in its left subtree is smaller, and everything in its right subtree is larger. This one rule is what makes searching fast — starting at the root, you compare your target to the current node: smaller, go left; larger, go right; equal, you're done. Each comparison **eliminates an entire half** of the remaining tree, the same halving idea from the phone-book example in F1 — which is exactly why a balanced BST gives you O(log n) search, insert, and delete.

The word **balanced** is doing real work in that last sentence. If you insert already-sorted data (1, 2, 3, 4, 5…) into a naive BST, every new node becomes the right child of the previous one, and you end up with what is structurally just a linked list wearing a tree's name — search degrades to O(n), because there's no branching left to eliminate half the candidates at each step. A **self-balancing** tree is one that performs extra bookkeeping on every insert/delete to guarantee the tree never gets that lopsided, keeping its height (and therefore its worst-case search cost) at O(log n) no matter what order you insert in.

A **red-black tree** is one specific, widely-used self-balancing scheme (`TreeMap` and `TreeSet` are built on one). The mechanism: every node is colored either red or black, and the tree maintains a small set of invariants (root is black; a red node never has a red child; every path from a given node down to any descendant "leaf" passes through the same number of black nodes) that, together, mathematically guarantee the longest possible path from root to leaf is never more than twice the shortest — which bounds the tree's height at O(log n). When an insert or delete would violate one of those invariants, the tree performs local **rotations** (restructuring a small number of nodes and re-coloring them) to restore them. You will not be asked to implement rotations by hand in an interview, and this guide won't walk through the rotation cases — but you *should* be able to say, in one sentence, what a red-black tree is for: **it's a binary search tree that does small amounts of extra work on every insert/delete specifically to prevent the "sorted input turns it into a linked list" degradation, which is what guarantees `TreeMap`'s O(log n) really holds in the worst case, not just on average.**

A **binary heap** (used by `PriorityQueue`, Chunk 10) is a different, looser kind of tree: it only guarantees that every parent is ≤ (or ≥) its children — not a full left/right ordering like a BST. That weaker guarantee is cheaper to maintain (O(log n) insert/remove, same as a red-black tree, but with much smaller constant factors) and is sufficient for "give me the smallest/largest item next," but it means the heap's elements are **not** fully sorted when you look at them all at once — only the root is guaranteed to be the extreme value. This is the precise reason `PriorityQueue.toString()` looks unsorted (Chunk 10) — you're seeing a valid heap, just not a sorted list.

## F7. Threads, race conditions, and the vocabulary of concurrency

A **thread** is an independent sequence of instructions that the CPU can run, and modern programs routinely run many threads *at once* (genuinely simultaneously on separate CPU cores, or interleaved rapidly on one core). The trouble starts when two threads touch the **same** piece of memory — for our purposes, the same collection object on the heap (F2) — without coordinating.

A **race condition** is a bug that occurs specifically because the *outcome* of the program depends on the unpredictable timing of two threads, rather than only on the logic you wrote. The canonical example, which Chunk 13 uses directly:

```java
if (!map.containsKey("k")) map.put("k", 1);
```

This looks like one step, but the CPU executes it as (at least) two separate operations: *check*, then *write*. If two threads both run this at nearly the same moment, both can see "not present" during their *check* (because neither has written yet), and both proceed to `put` — the second `put` silently overwrites the first, and you've lost an update, with no exception, no log line, nothing to indicate anything went wrong. This gap between "check" and "act" is called a **compound action**, and the fact that it isn't a single indivisible step is precisely the vulnerability.

An operation that genuinely cannot be split by another thread mid-way is called **atomic** — either it happens completely, or (as far as any other thread can observe) it hasn't happened at all, with no visible in-between state. `ConcurrentHashMap.putIfAbsent(k, v)` is atomic: it performs the check-and-write as one indivisible unit, so the race above cannot occur.

Two mechanisms Java uses to *achieve* atomicity, both referenced repeatedly in Chunk 13:

- A **lock** (Java's `synchronized` keyword, or explicit `Lock` objects) works by making other threads **wait** their turn: only one thread may hold the lock at a time, so anything done while holding it is effectively atomic with respect to other lock-holders. The cost is that waiting threads do nothing productive — pure lost throughput — while they wait, which is why locking every method of a shared `Hashtable`-style collection scales badly under heavy concurrent traffic.
- **CAS (compare-and-swap)** is a special CPU instruction that says, in one atomic hardware step: "if this memory location still holds the value I expect, replace it with my new value; otherwise, tell me it failed and give me the current value instead." No thread ever *waits* — instead, if a CAS fails (because another thread got there first), the losing thread simply retries with fresh information. This is called **lock-free** or **non-blocking** synchronization, and it's the mechanism `ConcurrentHashMap` uses for its lowest-contention paths (Chunk 13) — no thread blocks another; they just occasionally retry.

You'll also see the word **volatile** in passing (e.g., `CopyOnWriteArrayList`'s internal array reference is `volatile`). Without it, one thread's write to a shared variable is not *guaranteed* to become visible to another thread promptly — each CPU core can cache values locally, and without extra instructions, another core might keep reading a stale cached copy. Marking a variable `volatile` forces every read and write to go through main memory rather than a per-core cache, guaranteeing that once one thread writes it, the next thread to read it sees the new value. This is a **visibility** guarantee, distinct from atomicity — `volatile` alone does not make compound actions like the `containsKey`-then-`put` example above safe; it only ensures that whatever value *is* currently there is seen consistently.

## F8. Generics, from zero

Before diving into Chunk 2's wildcards, it helps to have the base concept solid. A **generic type** is a class or interface that is parameterized by another type, written in angle brackets: `List<String>` means "a `List` that specifically holds `String`s." The `<String>` is called a **type argument**, and inside the *definition* of `List<T>` itself, `T` is a **type parameter** — a placeholder standing in for "whatever type the user of this class chooses."

The entire point is to let the compiler catch a category of bug *before your program ever runs*, by remembering what type of thing a given collection is supposed to hold and rejecting any code that tries to put in — or read out as — the wrong type. Without it (as Chunk 2 shows with "raw types"), the compiler has no idea what's inside a collection, so a mistake like accidentally storing an `Integer` in a collection you meant to hold only `String`s compiles fine and then blows up as a `ClassCastException` at runtime, potentially long after the bad insert, in a completely different part of the code that just tried to read the value back out.

A related, easily-confused idea is a **bounded type parameter**, written `<T extends Comparable<T>>` — this doesn't mean "T is a wildcard for something unknown," it means "T can be *any* concrete type the caller chooses, but whatever it is, it must implement `Comparable<T>`." This lets a generic method call `.compareTo()` on values of type `T`, something the compiler couldn't allow if `T` might be *any* type at all (most types don't have a `compareTo`). Chunk 2's `maxOf` method uses exactly this.

**Wildcards** (`?`, `? extends X`, `? super X`) are a *different* tool from type parameters, used at the point where you're describing a type you're *accepting*, not one you're *defining*. Chunk 2 covers them, and PECS, in full depth once this baseline is in place.

## F9. Lambda expressions, method references, and functional interfaces

You'll see code like `Comparator.comparing(Employee::salary)` and `list.removeIf(u -> u.startsWith("spam"))` starting in the very first chunk. Both are ways of writing **a small, unnamed function and passing it around like a value** — something Java couldn't do at all before Java 8.

A **lambda expression** is that unnamed function written inline: `u -> u.startsWith("spam")` reads as "given some input, call it `u`, return `u.startsWith("spam")`." It's shorthand for writing a full one-method class just to pass a single behavior somewhere. Compare:

```java
// Pre-Java-8: an entire anonymous class just to describe "how do I filter"
list.removeIf(new Predicate<String>() {
    @Override public boolean test(String u) { return u.startsWith("spam"); }
});

// Java 8+: the same behavior, as a lambda
list.removeIf(u -> u.startsWith("spam"));
```

Both do exactly the same thing; the lambda is purely a more compact way to say it.

A **method reference** (`Employee::salary`, `String::toUpperCase`, `Integer::sum`) is an even shorter form for the extremely common case where the lambda body is just "call this one existing method." `Employee::salary` is shorthand for `e -> e.salary()`; `Integer::sum` is shorthand for `(a, b) -> Integer.sum(a, b)`. Nothing new is happening semantically — it's purely a syntax that avoids re-stating parameter names you're not going to use for anything except immediately forwarding them.

For either of these to compile, the *target* — the thing you're handing the lambda to, like the parameter type of `removeIf` — has to be a **functional interface**: an interface with exactly one abstract method (`Predicate<T>` has one: `boolean test(T t)`; `Comparator<T>` has one: `int compare(T a, T b)`). The lambda's body becomes the implementation of that single method; the compiler matches up the parameter and return types automatically. This is *why* a `Comparator` can be written as a lambda but an interface with two abstract methods could not be — there'd be no way to know which method your lambda was implementing.

You don't need to memorize the names of the standard functional interfaces (`Predicate<T>`, `Function<T,R>`, `Consumer<T>`, `Supplier<T>`, `BiFunction<T,U,R>`, etc.) to follow this guide — you need to recognize the *shape* on sight: `x -> ...` or `(x, y) -> ...` is "a small function passed as a value," and `Type::method` is the same thing spelled as a reference to an existing method instead of a freshly-written expression.

---
---

# Chunk 0 — Why Collections Exist At All

## The problem

Java gives you arrays out of the box:

```java
String[] users = new String[3];
users[0] = "alice";
users[1] = "bob";
users[2] = "carol";
```

Arrays have three fatal limitations for real software:

**1. Fixed size.** You must know the count up front. A web request handler receiving an unknown number of order line items cannot use a raw array without guessing or manually re-allocating.

```java
String[] users = new String[3];
users[3] = "dave";  // ArrayIndexOutOfBoundsException at RUNTIME
```

To grow it you have to hand-roll this every time:

```java
String[] bigger = new String[users.length * 2];
System.arraycopy(users, 0, bigger, 0, users.length);
users = bigger;
users[3] = "dave";
```

**2. No behaviour.** An array knows its length and nothing else. Want to check if "bob" exists? Write a loop. Remove "bob"? Write a loop, shift elements, resize. Sort? Write a sort. Every project reinvents these, each with its own subtle bugs.

**3. No abstraction.** An array is *one* data structure — contiguous memory with index access (see Chunk F3 for what "contiguous" buys you and costs you). But real problems need many:

- "Is this user ID already banned?" → needs a **set** (fast membership check)
- "What's the profile for user 8821?" → needs a **map** (key → value lookup)
- "Which job runs next by priority?" → needs a **heap/priority queue**
- "Give me the last 100 log lines in order" → needs a **deque**

## The concept

The **Java Collections Framework (JCF)** is a set of interfaces, implementations, and algorithms in `java.util` that solves all three problems:

- **Interfaces** (`List`, `Set`, `Map`, `Queue`) define *what* a collection does
- **Implementations** (`ArrayList`, `HashSet`, `HashMap`, `ArrayDeque`) define *how*
- **Algorithms** (`Collections.sort`, `Collections.binarySearch`) work across implementations

Before going further, it's worth being precise about what an **interface** actually is, because the rest of this framework — and a large fraction of well-designed Java code in general — is built on it. An interface is a **contract**: a named list of method signatures (names, parameters, return types) with **no implementation**. It says "anything claiming to be a `List` must provide these operations," but says nothing about *how*. A **class** that `implements` an interface is promising the compiler it provides real, working code for every one of those methods. Crucially, a variable can be *declared* with the interface type while *holding* any class that implements it:

```java
List<String> users = new ArrayList<>();   // the variable's declared type is the interface List
```

When you later call `users.add("dave")`, the compiler only checks that `add` exists on the `List` contract — it does **not** need to know, at the call site, whether the real object underneath is an `ArrayList`, a `LinkedList`, or something else entirely. At runtime, the JVM looks at the *actual* object on the heap (see Chunk F2 — `users` is a reference to a real object) and calls *that* object's own version of `add`. This mechanism — calling whichever concrete class's method actually applies, decided at runtime rather than baked in at compile time — is called **dynamic dispatch**, and it's the technical machinery underneath the more general term **polymorphism** ("many forms": the same line of calling code, `users.add(...)`, behaves differently depending on which concrete object `users` currently refers to).

This is precisely why the swap below is a one-line change and not a rewrite: the *declared* type of `users` never changes, only the *concrete* object it points at does, and every line that only ever spoke to the `List` contract keeps compiling and working exactly as before.

The whole thing rests on a single design principle: **program to the interface**.

```java
// Good: the variable type is the interface
List<String> users = new ArrayList<>();

// Later, if you need thread safety, ONE line changes:
List<String> users = new CopyOnWriteArrayList<>();
// Every other line of code in the file still compiles and works.
```

## Code

```java
import java.util.*;

public class WhyCollections {
    public static void main(String[] args) {
        // Grows automatically — no capacity math
        List<String> users = new ArrayList<>();
        users.add("alice");
        users.add("bob");
        users.add("carol");
        users.add("dave");           // just works

        // Behaviour is built in
        System.out.println(users.contains("bob"));   // true
        users.remove("bob");                          // shifting handled for you
        Collections.sort(users);                      // sorting handled for you
        System.out.println(users);                    // [alice, carol, dave]

        // Different structure for a different question
        Set<String> banned = new HashSet<>(List.of("mallory", "eve"));
        System.out.println(banned.contains("eve"));  // true, O(1) not O(n)

        Map<Integer, String> profiles = new HashMap<>();
        profiles.put(8821, "alice@example.com");
        System.out.println(profiles.get(8821));      // O(1) lookup by key
    }
}
```

## Real-world use case

**An e-commerce checkout service.** A single request touches four different collection types in about twenty lines of code:

```java
public OrderSummary checkout(Cart cart, String customerId) {
    // 1. LIST — line items, ordered, duplicates allowed (2x of same SKU as separate lines)
    List<LineItem> items = cart.getItems();

    // 2. SET — which promo codes have been applied (no duplicates allowed)
    Set<String> appliedPromos = new HashSet<>();

    // 3. MAP — SKU -> current inventory count, fetched in one batch call
    Map<String, Integer> stock = inventoryService.getStock(
        items.stream().map(LineItem::sku).toList());

    // 4. QUEUE — post-checkout side effects, processed asynchronously
    Queue<Event> outbox = new ArrayDeque<>();

    for (LineItem item : items) {
        if (stock.getOrDefault(item.sku(), 0) < item.qty()) {
            throw new OutOfStockException(item.sku());
        }
        outbox.add(new ReserveStockEvent(item.sku(), item.qty()));
    }
    ...
}
```

Using arrays here would mean hundreds of lines of index arithmetic, and `contains()` on promo codes would be a linear scan instead of a hash lookup.

## "Why not just…?"

> **"Why not just use arrays and write my own helper methods?"**

Because you'd be writing — and debugging, and maintaining — code that the JDK already ships, that has been battle-tested for 25+ years across billions of JVM instances, that is optimised by the JIT compiler with special-cased intrinsics, and that every other Java developer already understands on sight. Your custom `MyArrayHelper.remove()` is a code-review liability. `ArrayList.remove()` is not.

> **"Arrays are faster though, right?"**

For primitives, yes — `int[]` avoids the boxing overhead of `List<Integer>` (more in Chunk 16). That's a real, measurable win in tight numeric loops, image processing, or a matrix library. But `ArrayList<T>` for objects *is literally an array underneath* — an `Object[]` with a size counter. The overhead is one indirection (one extra reference hop, per Chunk F2 — reading `list.get(i)` reads the array reference stored inside the `ArrayList` object, then indexes into it, versus reading the array variable directly). In application code, that's noise compared to a network call or a database round-trip. Use arrays for primitive-heavy hot loops; use collections everywhere else.

> **"Why not use a `List` type everywhere including the variable declaration on the right side?"**

You mean `ArrayList<String> users = new ArrayList<>()`. It works, but it welds your method signatures to one implementation. If a method is declared as `void process(ArrayList<String> x)`, a caller holding a `LinkedList` or an immutable `List.of(...)` can't call it without copying. Declaring the parameter as `List<String>` accepts all of them. This is the single most common style note in Java code review.

---
---

# Chunk 1 — The Framework Map

## The problem

There are ~30 collection classes in `java.util` alone. Memorising them individually is hopeless. You need a mental map so that "I need X" leads you to the right box in a couple of seconds.

## The concept

Everything hangs off **two** root interfaces. This surprises people: **`Map` is not a `Collection`.**

```
                    Iterable<T>
                        │
                   Collection<E>
                        │
       ┌────────────────┼────────────────┐
       │                │                │
    List<E>          Set<E>          Queue<E>
       │                │                │
       │          ┌─────┴──────┐         │
       │       SortedSet    (plain)   Deque<E>
       │          │
       │      NavigableSet


                     Map<K,V>          ← SEPARATE ROOT, not a Collection
                        │
                   SortedMap<K,V>
                        │
                  NavigableMap<K,V>
```

Read this diagram as a chain of "is-a" promises, top to bottom: anything that is a `List` is *also* a `Collection` (it inherits every method `Collection` promises, plus adds its own), and anything that is a `Collection` is *also* `Iterable` (usable in a for-each loop). An interface lower in the tree is strictly *more specific* — it keeps every guarantee of everything above it and adds new ones. `NavigableSet` therefore guarantees everything `SortedSet` does (sorted order), everything `Set` does (uniqueness), everything `Collection` does (add/remove/size), *and* nearest-neighbour search on top. This is why picking the right interface for a variable's declared type (Chunk 0) matters: the higher up the tree you declare it, the *fewer* guarantees your code can rely on, but the *more* concrete implementations can satisfy it.

### The interfaces, one line each

| Interface | Contract | Duplicates? | Ordered? | Key idea |
|---|---|---|---|---|
| `Iterable<T>` | Can be used in a for-each loop | — | — | Supplies an `Iterator` |
| `Collection<E>` | A group of elements: add/remove/size/contains | depends | depends | Base of all groups |
| `List<E>` | **Positional** access by index | ✅ yes | ✅ insertion order | "A numbered row of items" |
| `Set<E>` | **Uniqueness** | ❌ no | depends on impl | "A bag of distinct things" |
| `SortedSet<E>` | Set kept in sorted order | ❌ no | ✅ sort order | `first()`, `last()`, `headSet()` |
| `NavigableSet<E>` | SortedSet + nearest-neighbour search | ❌ no | ✅ | `floor()`, `ceiling()`, `higher()`, `lower()` |
| `Queue<E>` | **Order of processing**, usually FIFO | ✅ yes | ✅ | `offer()`, `poll()`, `peek()` |
| `Deque<E>` | Double-ended queue — insert/remove at both ends | ✅ yes | ✅ | Works as both queue *and* stack |
| `Map<K,V>` | **Key → value** association | keys unique, values may repeat | depends | "A dictionary / lookup table" |
| `SortedMap<K,V>` | Map kept sorted by key | | ✅ | `firstKey()`, `subMap()` |
| `NavigableMap<K,V>` | SortedMap + nearest-key search | | ✅ | `floorKey()`, `ceilingEntry()` |

A quick note on two words in that table that are easy to gloss over: "**ordered**" here means the collection has a *predictable, defined* iteration sequence — it does **not** necessarily mean *sorted*. A plain `List` is ordered (you always get elements back in insertion order) without being sorted at all (`[3, 1, 2]` is a perfectly valid `List`). "Sorted," used for `SortedSet`/`SortedMap`, is the stronger, more specific claim that the order also happens to be ascending by some comparison rule. Every sorted collection is ordered; not every ordered collection is sorted.

### The implementations, by interface

| Interface | Hash-based | Insertion-ordered | Sorted | Array/Linked | Concurrent |
|---|---|---|---|---|---|
| **List** | — | `ArrayList`, `LinkedList` | — | `ArrayList` (array), `LinkedList` (doubly-linked) | `CopyOnWriteArrayList` |
| **Set** | `HashSet` | `LinkedHashSet` | `TreeSet` | — | `ConcurrentSkipListSet`, `CopyOnWriteArraySet` |
| **Map** | `HashMap` | `LinkedHashMap` | `TreeMap` | — | `ConcurrentHashMap`, `ConcurrentSkipListMap` |
| **Queue/Deque** | — | `ArrayDeque`, `LinkedList` | `PriorityQueue` | — | `ConcurrentLinkedQueue`, `ArrayBlockingQueue`, `LinkedBlockingQueue` |
| **Enum-specialised** | `EnumSet`, `EnumMap` | | | | |
| **Legacy (avoid)** | `Hashtable`, `Vector`, `Stack` | | | | |

Notice the shape of this table: for `Set` and `Map`, the row headers repeat almost exactly — `HashSet`/`HashMap`, `LinkedHashSet`/`LinkedHashMap`, `TreeSet`/`TreeMap`. That's not a coincidence you need to memorise separately; every `XxxSet` is, internally, backed by an `XxxMap` where the values are a dummy placeholder object and only the keys are used (Chunk 7 shows this explicitly for `HashSet`/`HashMap`). Learning `HashMap`'s internals in Chunk 8 is therefore learning roughly 80% of `HashSet`'s internals for free.

### One more marker interface worth knowing

`RandomAccess` is an **empty marker interface** — it declares zero methods. Its only purpose is to let library code ask, via `instanceof`, "does this particular object support cheap indexed access?" without needing to actually measure. `ArrayList` implements it (because `get(i)` really is O(1), per Chunk F3); `LinkedList` does not (because `get(i)` is O(n)). Library code checks for it to pick a loop strategy:

```java
// Inside Collections.binarySearch, roughly:
if (list instanceof RandomAccess || list.size() < THRESHOLD) {
    // use index-based get(i) — cheap for ArrayList
} else {
    // use a ListIterator — avoids O(n) get(i) on LinkedList
}
```

Why does this matter enough to be its own interface? Because without it, a generic algorithm written against the `List` interface has no way to know, just from the type, whether `get(i)` in a loop will be O(n) total (`ArrayList`) or O(n²) total (`LinkedList`, since *each* `get(i)` call is itself O(n)) — and picking the wrong loop strategy on a large `LinkedList` can turn an algorithm that should be fast into one that silently grinds to a halt. You'll rarely implement `RandomAccess` yourself, but knowing why it exists is a classic SDE-2 interview question, and now you can answer it in one sentence: it's a zero-method flag that lets algorithms avoid an accidental O(n²).

## Code

```java
import java.util.*;

public class FrameworkMap {
    public static void main(String[] args) {
        // Same interface variable, four very different behaviours

        List<Integer> arrayList  = new ArrayList<>(List.of(3, 1, 2, 1));
        System.out.println(arrayList);      // [3, 1, 2, 1]  insertion order, dupes kept

        Set<Integer> hashSet     = new HashSet<>(List.of(3, 1, 2, 1));
        System.out.println(hashSet);        // [1, 2, 3]  dupes gone, order NOT guaranteed

        Set<Integer> linkedSet   = new LinkedHashSet<>(List.of(3, 1, 2, 1));
        System.out.println(linkedSet);      // [3, 1, 2]  dupes gone, insertion order kept

        Set<Integer> treeSet     = new TreeSet<>(List.of(3, 1, 2, 1));
        System.out.println(treeSet);        // [1, 2, 3]  dupes gone, sorted

        Queue<Integer> queue     = new ArrayDeque<>(List.of(3, 1, 2, 1));
        System.out.println(queue.poll());   // 3  — FIFO, first in first out

        Queue<Integer> heap      = new PriorityQueue<>(List.of(3, 1, 2, 1));
        System.out.println(heap.poll());    // 1  — smallest first, not insertion order
    }
}
```

## Real-world use case

**Designing a REST API response type.** The interface you choose in your method signature *is* your contract:

```java
public interface UserRepository {
    // List: "ordering is meaningful and I may return duplicates"
    List<User> findRecentSignups(int limit);

    // Set: "these are distinct, order is not part of my promise"
    Set<Role> getRolesFor(String userId);

    // Map: "look these up by id"
    Map<String, User> findByIds(Collection<String> ids);

    // NavigableMap: "you'll want range queries on this"
    NavigableMap<Instant, LoginEvent> getLoginHistory(String userId);
}
```

A reviewer reading only these signatures already knows the semantics. If `getRolesFor` returned `List<Role>`, every caller would have to wonder "can this contain ADMIN twice?"

## "Why not just…?"

> **"Why isn't `Map` a `Collection`? It holds a bunch of things."**

Because the `Collection` contract is built around a *single element type* `E`: `add(E)`, `contains(E)`, `remove(E)`, `Iterator<E>`. A map holds **pairs**. `map.add(x)` is meaningless — add what, a key or a value? Josh Bloch (the JCF designer) has said forcing `Map` into `Collection` would have produced a worse API than keeping them separate. What you get instead are three *views* that **are** collections:

```java
Set<K>            keys    = map.keySet();
Collection<V>     values  = map.values();     // Collection, not Set — values can repeat
Set<Map.Entry<K,V>> pairs = map.entrySet();   // best for iteration
```

These are **live views**, not copies — removing from `keySet()` removes from the map. This is the same reference-sharing idea from Chunk F2: `keySet()` doesn't build you a *new* `Set` containing copies of the keys; it hands back an object that is wired directly into the map's own internal structure, so changes through one are visible through the other, because underneath there's really just one object holding the actual data.

> **"Why so many implementations? Can't there be one good `Set`?"**

Because there is no single best data structure. `HashSet.contains()` is O(1) but iteration order ... (252 KB left)
