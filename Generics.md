# Java Generics — The Complete Guide (SDE 1 → SDE 2) (Expanded Edition)

> **What's different in this edition.** The original 20 chunks are outstanding at teaching generics *as a design tool* — PECS, invariance, erasure, recursive bounds, type tokens — with real code and real production stories. What they lean on, constantly and without re-deriving it, is a layer of vocabulary underneath generics: what a compiler and the JVM actually do with your code, what a reference and the heap are, how inheritance and method dispatch work, where lambdas and functional interfaces come from, and how reflection and annotations let frameworks read the types you declared. If you already have that vocabulary, the original reads as advanced-but-clear. If you're still building it, several chunks quietly assume you have it.
>
> This edition adds one new chunk — **Chunk F, Foundations** — that builds that vocabulary from first principles, and weaves cross-references back to it into every one of the original 20 chunks. **Every original chunk is otherwise completely unchanged** — every code sample, every "Why can't I just…?", every Gotcha and Recap survives exactly as written — with deeper connective explanation woven in around it.

> **How to use this document.** It's split into 21 chunks. Chunk F is new; read it first if any of its topics feel shaky, or use it as a reference and jump back to it from the cross-references in later chunks. Chunks 1–20 follow the original's shape:
> **The Problem → The Concept → Code → Real-World Use Case → "Why can't I just…?" → Gotchas → Recap.**
> Read chunks 1–8 first (that's ~80% of daily work). Chunks 9–17 are what separates SDE 1 from SDE 2.
> Chunk 18 is an interview drill, 19 is a cheat sheet, 20 is practice.

---

## Table of Contents

| # | Chunk | Why it matters |
|---|-------|----------------|
| F | Foundations | The vocabulary every other chunk assumes: compilation & bytecode, references & the heap, inheritance & dispatch, substitutability & variance, lambdas, reflection, annotations. |
| 1 | Life Before Generics | The motivation. Don't skip. |
| 2 | Generic Classes | Writing your own `Box<T>`, `Pair<K,V>` |
| 3 | Generic Methods | Methods with their own type parameters |
| 4 | Bounded Type Parameters | `<T extends Number>`, multiple bounds |
| 5 | Type Erasure | The single most important concept in Java generics |
| 6 | Generics and Inheritance (Invariance) | Why `List<String>` is NOT a `List<Object>` |
| 7 | Wildcards & PECS | `? extends`, `? super`, `?` |
| 8 | Generic Interfaces | `Comparable`, `Comparator`, `Repository<T, ID>` |
| 9 | Recursive Generics (Self-Referential Bounds) | `<T extends Comparable<T>>`, generic builders |
| 10 | Generics and Arrays | Why `new T[]` is illegal, heap pollution, `@SafeVarargs` |
| 11 | The Full Restrictions List | Every "you can't do that" with the reason |
| 12 | Type Tokens & Super Type Tokens | Getting type info back at runtime (Jackson, Spring) |
| 13 | Generics in the JDK | Collections, `Optional`, `Stream`, `CompletableFuture` |
| 14 | Generics in Real Frameworks | Spring, JPA, Jackson, Retrofit, Feign, JUnit |
| 15 | Raw Types, Unchecked Warnings & Legacy Code | Surviving old codebases |
| 16 | Type Inference Deep Dive | Diamond, target typing, `var`, type witness |
| 17 | Modern Java (8 → 21) | Generic records, sealed types, pattern matching |
| 18 | Interview Questions | With model answers |
| 19 | Cheat Sheet & Decision Tables | Print this |
| 20 | Practice Exercises | With solutions |

---

# Chunk F — Foundations

## F1. Compile-Time vs Runtime, and What "The Compiler" Actually Does

Chunk 5 calls type erasure "the single most important concept in Java generics," and it hinges entirely on a distinction the rest of the document uses constantly without spelling out: the difference between **compile-time** and **runtime**.

**Two separate programs touch your code before a user ever sees a result.** First, `javac` — the Java *compiler* — reads your `.java` source files and translates them into `.class` files full of **bytecode**: a compact, platform-independent instruction set. This happens once, at build time, and produces no running program — it's a pure translation-and-checking pass. Second, the **JVM** loads those `.class` files and *executes* the bytecode — this is what happens when you run `java -jar app.jar`.

**Compile-time** means "during that first pass, before the program runs, working only from the source text." **Runtime** means "while the JVM is actually executing instructions, in response to real input." This is the entire fault line generics sits on:

- `list.add(42)` on a `List<String>` is a **compile error** because the compiler can prove, just from reading the declared types in your source, that `42` (an `Integer`) can never be a `String`. No program needs to run for this to be provable.
- `(String) names.get(i)` throwing a `ClassCastException` in Chunk 1's pre-generics example is a **runtime error** because whether `names.get(i)` actually holds a `String` depends on what was put into the list — data the compiler has no way to know in advance.

Generics are, in this framing, **a notation that lets you write down more information at compile time** — "this list holds Strings" — so the compiler's already-existing type-checking machinery (the same machinery that catches `int x = "hello";`) can check something it previously couldn't. Chunk 1's core insight — "the information existed in the programmer's head, generics let you write it down" — is really the claim that generics move a fact from being *invisible to the compiler* to being *part of the source text the compiler reads*.

This distinction is what makes Chunk 5 (erasure) coherent: the compiler uses your generic type information exhaustively **during** compilation — checking every `add`, inferring every `T`, inserting every cast — and then, because that information has done its job, it doesn't bother keeping it around in the `.class` file. "Erasure" is not the JVM losing information it needed; it's the compiler finishing a compile-time-only job and not exporting the scratch work. Every restriction in Chunk 11 ("can't do `new T()`," "can't do `instanceof List<String>`") is a restriction that exists precisely at the runtime side of this boundary — things the JVM would need to check, but has no data left to check them with.

## F2. References, the Heap, and Aliasing

Chunk 6's proof of why generics must be invariant — "`strings` and `objects` point to the same list object" — depends on a mental model of what a Java variable actually holds, which is worth making explicit.

When you write `List<String> strings = new ArrayList<>();`, the variable `strings` does not hold the list itself. It holds a **reference** — essentially a pointer — to an `ArrayList` object that lives on the **heap**, a single shared region of memory used by the whole program for every object created with `new`. `List<Object> objects = strings;` (if it compiled) would not copy the list; it would copy the *reference*, so that `objects` and `strings` are now two different names pointing at the **exact same heap object**.

This is called **aliasing**: two or more references pointing at one shared, mutable object. It's the entire reason Chunk 6's proof works:

```java
List<String> strings = new ArrayList<>();
List<Object> objects = strings;        // objects and strings now alias the SAME list

objects.add(42);                       // mutates the shared object through one alias
String s = strings.get(0);             // reads the same mutation through the other alias — 💥
```

If `List<String>` and `List<Object>` were different, non-aliased copies of data, none of this would be dangerous — a write through `objects` would never be visible through `strings`. It's specifically because a reference doesn't carry a copy, only a pointer to shared mutable state, that writing through one view of an object can corrupt what another view of the *same* object expects to see. **Invariance exists to prevent bad writes through an aliased reference of a different apparent type** — that sentence is Chunk 6 compressed to its essence, and it only makes sense once "reference" means "pointer to shared heap state" rather than "a copy of the value."

This also explains why `List<?> a = strings;` (Chunk 7, the unbounded wildcard) is safe even though it's still aliasing the same object: `List<?>` forbids every write except `null`, so no alias typed `List<?>` can ever perform the dangerous write in the first place — the aliasing is identical to the `List<Object>` case, but the *capability* granted by that particular reference's type is deliberately weaker.

## F3. Classes, Interfaces, and Inheritance: "Is-A", Overriding vs Overloading

Chunk 6's invariance proof, Chunk 5's bridge methods, and Chunk 8's generic interfaces all lean on inheritance vocabulary used but not re-derived.

**A class is a template; an object is one instance built from it.** `class Order { }` describes the shape every `Order` object will have. **Inheritance**, via `extends` (for classes) or `implements` (for interfaces), lets one type be defined as "everything the other type has, plus more":

```java
class Person { }
class Employee extends Person { }     // Employee IS-A Person
```

This "is-a" relationship is exactly what licenses `Person p = new Employee();` — code written to expect a `Person` can be handed an `Employee` and everything the code does with `p` (calling `Person`'s methods) still works, because an `Employee` is guaranteed to have everything a `Person` has. This is **subtype polymorphism**, and it's the general mechanism Chunk 6 is asking about when it asks why `List<String>` isn't a subtype of `List<Object>` the way `Employee` is a subtype of `Person` — the answer (invariance, F2 above) is precisely that generic types opt *out* of this default behavior for type arguments, because unlike a plain object reference, a container's stored elements can be mutated through any alias.

**Overriding** is a subclass providing its own implementation of a method the superclass already declares, using the identical signature (name + parameter types). **Overloading** is a *different* thing entirely — multiple methods with the *same name* but *different* parameter types, in the same or a related class — resolved at compile time based on the static types of the arguments, not at runtime based on the actual object. Chunk 5's "erasure-clashing overloads" and Chunk 3's `firstOrNull(List<String>)` / `firstOrNull(List<Integer>)` example are both about overloading, not overriding: after erasure, both methods have the parameter type `List`, and Java forbids two methods in the same class from sharing a name and parameter-type signature — the compiler can't tell them apart at the bytecode level (more on this in F6).

Bridge methods (Chunk 5) exist specifically to preserve *overriding*, not overloading, across erasure: `StringNode.setData(String)` must count as *overriding* `Node.setData(T)` (erased to `Node.setData(Object)`) for polymorphism to keep working when code holds a plain `Node` reference — and since `setData(String)` and `setData(Object)` are different signatures, the compiler manufactures a third method, `setData(Object)`, purely to make the override relationship hold at the bytecode level.

## F4. The Liskov Substitution Principle and Variance

Chunk 6 proves, with a concrete code example, exactly *why* `List<String>` cannot safely be a `List<Object>`. This section names the general principle that proof is an instance of, and gives the vocabulary — **covariance**, **contravariance**, **invariance** — a foundation beyond "memorize which wildcard does which."

The **Liskov Substitution Principle** (LSP), formulated by Barbara Liskov in 1987, says: *if `S` is a subtype of `T`, objects of type `T` may be replaced with objects of type `S` without breaking any property the surrounding code relies on.* In plain terms: **substituting a subtype for its supertype must never surprise code written against the supertype.**

`Employee extends Person` satisfies LSP for ordinary object references: any code that only calls `Person`'s methods on a `Person`-typed variable behaves identically whether the actual object is a `Person` or an `Employee`. But Chunk 6's proof shows that `List<Employee>` standing in for `List<Person>` would **violate** LSP: code holding a `List<Person>` reference is entitled, by the type, to call `add(new Person(...))` — and if that reference actually pointed at a `List<Employee>`, the `Employee`-only invariant of the real underlying list would be silently broken. Generic invariance is Java choosing, correctly, not to offer a substitution that would violate LSP by default.

**Variance** is the general vocabulary (borrowed from mathematics, where a function's behavior under an ordering is called covariant or contravariant depending on whether it preserves or reverses the ordering) for *how* a compound type's subtyping relationship relates to its component type's subtyping relationship:

| Term | Meaning | Java example |
|---|---|---|
| **Covariant** | If `S extends T`, then `Container<S>` is treated as a subtype of `Container<T>` | `String[]` as `Object[]` (arrays); `List<? extends T>` (wildcards) |
| **Contravariant** | If `S extends T`, then `Container<T>` is treated as a subtype of `Container<S>` — the relationship *reverses* | `List<? super T>` (wildcards); a method parameter type in an override, in principle (Java doesn't allow this for regular overriding, but it's why `Comparator<? super T>` works) |
| **Invariant** | No subtyping relationship at all between `Container<S>` and `Container<T>`, regardless of `S`/`T`'s relationship | Plain `List<T>` in Java — Chunk 6's whole subject |

Chunk 7's `? extends T` (**covariant** — a `List<? extends Number>` can safely stand in wherever you only read, because reading through a covariant view can't violate LSP: every possible concrete type behind the wildcard genuinely IS-A `Number`) and `? super T` (**contravariant** — a `List<? super Integer>` can safely stand in wherever you only write `Integer`s, because every possible concrete type behind the wildcard is guaranteed to accept an `Integer`) are exactly these two rows, made concrete as Java syntax. PECS (Producer *Extends*, Consumer *Super*) is a mnemonic for choosing the correct row based on which direction data flows — which is also why arrays (F7 below) being unconditionally covariant, even for writes, is the acknowledged design mistake Chunk 6 discusses: arrays chose covariance for the *whole* type, including the unsafe write direction, and pay for it with a runtime check that generics simply refuse to need by defaulting to invariance and only offering covariance/contravariance through wildcards, in the narrow, statically-checkable positions where they're actually safe.

## F5. Functional Interfaces and Lambdas, From Zero

`Function<T, R>`, `Supplier<T>`, `Consumer<T>`, and `Predicate<T>` appear starting in Chunk 3's `Retry` utility, long before Chunk 8 formally introduces them as "generic interfaces." Here's what they are and where lambdas come from.

**A functional interface** is an interface with exactly one abstract method (a "SAM" — Single Abstract Method). It may have any number of `default` or `static` methods, but only one method a caller must actually implement:

```java
@FunctionalInterface
public interface Function<T, R> {
    R apply(T t);          // the ONE abstract method
    default <V> Function<T, V> andThen(Function<? super R, ? extends V> after) { ... }  // default — doesn't count
}
```

**A lambda expression** (`x -> x * 2`) is shorthand syntax for an anonymous object implementing a functional interface's single abstract method. The compiler figures out *which* interface from context — the **target type** (the declared type of whatever the lambda is being assigned to, passed as, or returned as):

```java
Function<Integer, Integer> doubler = x -> x * 2;
// Compiles to (conceptually) an anonymous class:
Function<Integer, Integer> doubler = new Function<Integer, Integer>() {
    public Integer apply(Integer x) { return x * 2; }
};
```

The generic type parameters (`T`, `R` in `Function<T, R>`) are what let the *same* interface, `Function`, describe a lambda from `String` to `Integer`, or from `Order` to `BigDecimal`, or anything else — one functional interface, infinitely many lambda shapes, exactly the way `Box<T>` is one class describing infinitely many box shapes (Chunk 2). This is why `java.util.function` is, as Chunk 8 puts it, "entirely generic interfaces": genericity is precisely the mechanism that lets a handful of interfaces (`Function`, `Supplier`, `Consumer`, `Predicate`, `BiFunction`, …) cover every possible lambda signature, instead of the language needing a distinct interface type for every combination of input and output types.

Method references (`String::length`, `User::getEmail`) are a further shorthand for a lambda that does nothing but call one existing method — `s -> s.length()` and `String::length` compile to the same thing. Both lambdas and method references are checked against their target type's generic parameters exactly like any other value, which is why `Function<String, Integer> f = someMethodTakingLocalDate;` is a compile error: the referenced method's actual signature doesn't match the functional interface's type arguments.

## F6. How the JVM Resolves Method Calls: Signatures, Overloading, and Dynamic Dispatch

Chunk 3's "same erasure" compile error and Chunk 5's bridge methods both depend on precisely how Java decides which method a given call actually invokes — a two-stage process most of this document calls "signature" without unpacking.

A method's **signature** is its name plus the number and types of its parameters (the return type is *not* part of the signature for overload-resolution purposes, which is why you can't overload on return type alone). At **compile time**, when the compiler sees a call like `firstOrNull(names)`, it performs **overload resolution**: among every method visible with that name, it picks the one whose parameter types best match the *static* (declared) types of the arguments. This is a purely compile-time decision — baked into the bytecode as a specific method reference before the program ever runs.

At **runtime**, when the call is actually to an instance method that could be overridden (not `static`, `private`, or `final`), the JVM performs **dynamic dispatch**: it looks at the *actual runtime class* of the object the method is being called on, and picks that class's version of the (already overload-resolved) method. This is how `Person p = new Employee(); p.greet();` calls `Employee`'s `greet()` even though `p`'s *declared* type is `Person` — overload resolution already picked "the no-arg `greet` method" at compile time; dynamic dispatch decides, at the moment of the call, *whose* implementation of that method actually runs, based on what `p` really points to on the heap.

Two facts from this machinery explain document-wide behavior:

- **Overloading is resolved purely from compile-time signatures**, which is exactly why `process(List<String> list)` and `process(List<Integer> list)` (Chunk 3, Chunk 5) is a compile error after erasure: erasure happens *before* the signatures reach the stage where the JVM would need to distinguish them, so by the time there'd be two methods to choose between, they look identical.
- **Dynamic dispatch is what bridge methods (Chunk 5) are protecting.** `Node n = new StringNode(...); n.setData(42);` needs dynamic dispatch to find `StringNode`'s override — but dynamic dispatch matches on the erased signature (`setData(Object)`), and `StringNode` only defines `setData(String)`. The bridge method `setData(Object)` exists purely so dynamic dispatch has something to find with the erased signature, which then manually forwards to the real, type-specific method.

## F7. Arrays in the JVM: Component Types and the Runtime Store Check

Chunk 6 contrasts array covariance with generic invariance, and Chunk 10 covers arrays and generics in depth; both assume you know arrays carry more runtime information than generic types do.

Unlike a generic type, a Java array **is reifiable** (Chunk 5's term for "survives to runtime"): every array object, on the heap, stores its **component type** as part of its own runtime metadata — a `String[]` genuinely knows, at runtime, that it holds `String`s, unlike a `List<String>`, which is indistinguishable from a `List<Integer>` after erasure. This is precisely why arrays were made covariant back in Java 1.0, before generics existed: `Arrays.sort(Object[])` needed to accept a `String[]` directly, and the JVM had the runtime information to make covariance *checkable*, if not *safe* at compile time.

That runtime check is called the **array store check**: every time you assign into an array slot (`arr[i] = value`), the JVM compares `value`'s actual runtime type against the array's stored component type, and throws `ArrayStoreException` if they don't match:

```java
Object[] objects = new String[3];   // covariant assignment — compiles
objects[0] = "ok";                  // passes the store check — String matches component type String
objects[1] = 42;                    // 💥 ArrayStoreException — the check catches it, at RUNTIME
```

This is the mechanism Chunk 6's comparison table is describing when it says arrays are "checked at runtime" and generics "at compile time" — arrays *can* be checked at runtime specifically because the component type is reified, not erased. Chunk 10's illegality of `new T[]`/`new List<String>[]` is exactly the case where this runtime check would be worthless: the array's component type would be `List` (erased), so two different, genuinely incompatible parameterizations (`List<String>[]` vs `List<Integer>[]`) would look identical to the store check, defeating the one safety net covariant arrays actually have.

## F8. Reflection: Class Objects and Introspecting Types at Runtime

Chunk 12 (type tokens) and Chunk 14 (frameworks) both depend on **reflection** — the mechanism a running Java program uses to inspect its own classes, methods, and types, rather than relying only on what the compiler already checked.

Every loaded class has exactly one runtime `Class` object representing it, obtainable via `SomeType.class`, `object.getClass()`, or `Class.forName("...")`. `Class<T>` is itself generic — `User.class` has the *static* type `Class<User>` — which is the entire trick behind a **type token** (Chunk 12): passing a `Class<T>` value is passing a live, inspectable, runtime object that also happens to carry compile-time type information binding `T`, because of how generics let you parameterize `Class` itself.

Beyond simple class lookups, the `java.lang.reflect` package lets code introspect much more: `Field`, `Method`, and `Constructor` objects describe a class's members, and can be queried for their *generic* signatures via methods like `Field.getGenericType()` or `Method.getGenericReturnType()`, which return a `Type` — a broader interface than `Class`, with a subtype `ParameterizedType` that specifically represents a still-generic type like `List<User>`, including its actual type arguments. This is the exact mechanism super type tokens (Chunk 12) and framework type resolution (Chunk 14, Spring Data reading `JpaRepository<User, Long>`) rely on: **erasure removes type-argument information from object *instances*, but it does not remove type-argument information from *class, field, and method metadata*** — that metadata is compiled into the `.class` file precisely so tools like debuggers, IDEs, and reflection-based frameworks can still see it. Reflection is how code reaches into that metadata at runtime.

Reflection calls are also, notably, **not checked by the compiler** the way ordinary code is — `class.getDeclaredMethod("process", List.class)` compiles regardless of whether such a method actually exists, and fails (with a checked exception) only when it actually runs. This is a second, independent kind of "runtime-only" checking, distinct from generics' erasure-based limitations, and it's why reflection-heavy framework code (Chunk 14) tends to have much weaker compile-time guarantees than ordinary generic code, even though both ultimately depend on `Class`/`Type` objects to do their jobs.

## F9. Annotations and How Frameworks Use Reflection

Chunk 14's Spring and JPA examples (`@Component`, `@Repository`, `@Query`, `@GetMapping`) assume familiarity with what an annotation actually is and how a framework turns one into behavior.

**An annotation** (`@Component`, `@Override`, `@SuppressWarnings`) is metadata attached to a class, method, field, or parameter — declared with `@interface`, and, by itself, completely inert. Writing `@Repository` above a class does not, on its own, make Spring do anything; the JVM doesn't read custom annotations and change behavior automatically. Something else has to notice the annotation and act on it.

That "something else" is almost always **reflection** (F8): at startup, Spring scans your classpath, and for each class, uses reflection to ask "does this class have `@Component` (or `@Repository`, `@Service`, …) on it?" and "does this interface extend `JpaRepository<T, ID>`, and if so, what are `T` and `ID`?" — the second question is answered exactly the way Chunk 12's `GenericTypeResolver` answers it: by reading the interface's generic superclass/superinterface metadata via reflection, the same metadata F8 describes as surviving erasure. Once Spring has that information, it uses more reflection — and, for many features, dynamically generated proxy classes — to construct the actual runtime behavior: a `JpaRepository<User, Long>` bean that knows, without you writing a line of implementation, that `findById` should query the `users` table and return `Optional<User>`.

This is the general shape behind every "magic" framework behavior this document's Chunk 14 walks through: **an annotation marks intent, reflection reads both the annotation and the surrounding generic type information, and the framework's own code — not the compiler, not the JVM — turns that combination into runtime behavior.** Retrofit reading `Call<List<Repo>>` off a method's generic return type, Jackson's `TypeReference` reading a superclass's `ParameterizedType`, and Spring Data reading `JpaRepository<User, Long>`'s type arguments are all the same pattern with different annotations and different generic shapes being read.

---

# Chunk 1 — Life Before Generics (The Motivation)

## The Problem

Java got generics in **Java 5 (2004)**. Before that, every collection stored `Object`.

```java
// Java 1.4 — the dark ages
List names = new ArrayList();      // a list of... something
names.add("Alice");
names.add("Bob");
names.add(42);                     // compiles fine. nobody stops you.

for (int i = 0; i < names.size(); i++) {
    String name = (String) names.get(i);   // manual cast, every single time
    System.out.println(name.toUpperCase());
}
```

Run it and you get:

```
ALICE
BOB
Exception in thread "main" java.lang.ClassCastException:
    class java.lang.Integer cannot be cast to class java.lang.String
```

Three separate problems here, and they compound:

1. **No type safety.** `names.add(42)` was a bug, but the compiler happily accepted it.
2. **The failure is delayed.** The bad `add` happened on line 4. The crash happens on line 8 — possibly hours later, possibly in production, possibly in a different class written by a different team.
3. **Casting noise.** Every read needs `(String)`. It's verbose and it's a lie you're telling the compiler ("trust me, this is a String").

> **The core insight:** the *information* that "this list holds Strings" existed in the programmer's head, but there was no way to write it down. Generics are a **notation for writing down that information** so the compiler can check it.

This is [F1](#f1-compile-time-vs-runtime-and-what-the-compiler-actually-does)'s compile-time/runtime boundary in its most direct form: `names.add(42)` and `(String) names.get(i)` are both perfectly legal *bytecode-producing* statements — nothing about them is malformed. The bug is a fact about the program's intent ("this collection only ever holds `String`s") that simply has nowhere to live before generics exist. `javac` cannot enforce a rule it was never told, and the `ClassCastException` is the JVM discovering, at runtime, a violation of a rule that was only ever real in the programmer's head.

## The Concept

Generics let you **parameterize a type by another type**.

```java
List<String> names = new ArrayList<>();
names.add("Alice");
names.add("Bob");
// names.add(42);   // ❌ COMPILE ERROR — caught in your IDE, in red, right now

for (String name : names) {        // no cast needed
    System.out.println(name.toUpperCase());
}
```

The error message you get is:

```
incompatible types: int cannot be converted to String
```

Notice **when** you get it: while typing, not at 3 AM during an incident.

## Real-World Use Case

You're on a payments team. There's a service that returns transaction IDs.

```java
// Without generics — a real bug pattern
public class TransactionService {
    public List getRecentTransactionIds() {   // raw List
        List ids = new ArrayList();
        ids.add("TXN-1001");
        ids.add("TXN-1002");
        return ids;
    }
}

// Six months later, a new hire "optimizes" it:
ids.add(1003L);   // "IDs are numbers, right?" — compiles fine

// Meanwhile, in the reconciliation job that runs nightly at 2 AM:
for (Object o : service.getRecentTransactionIds()) {
    String id = (String) o;                    // 💥 ClassCastException at 2:07 AM
    ledger.markSettled(id);
}
```

With generics, the "optimization" never compiles. The bug is impossible to write.

```java
public List<String> getRecentTransactionIds() { ... }
// ids.add(1003L);   ❌ won't compile
```

This is the whole value proposition: **move errors from runtime to compile time**. Compile-time errors cost you 5 seconds. Runtime errors in a payments pipeline cost you a postmortem.

## "Why can't I just…?"

**"…use `Object` and cast? It works."**

It works until it doesn't, and you have no way to know which case you're in. The cast is an *assertion* you can't verify. Also:
- Your IDE can't autocomplete. `list.get(0).` shows you `Object` methods only.
- Refactoring tools can't help you. Rename `TransactionId` → nothing updates.
- Code review can't catch it. The bad line looks identical to the good line.

**"…just write good tests?"**

Tests catch bugs you thought of. The compiler catches bugs you didn't. And type checking is *exhaustive* — it checks every path, including the ones your tests don't cover. Generics are essentially free, always-on tests for one specific class of bug.

**"…name my variables carefully, like `stringList`?"**

That's a comment, not a check. Comments lie. Nothing stops `stringList.add(42)`.

## Gotchas

- Generics are **compile-time only**. At runtime, `List<String>` and `List<Integer>` are the same class. (This is *type erasure* — Chunk 5. It explains almost every weird generics rule.)
- Generics give you **no performance benefit**. The generated bytecode is nearly identical to the hand-cast version. The benefit is 100% about correctness and readability.
- Generics only work with **reference types**, not primitives. `List<int>` is illegal; you use `List<Integer>` and pay for autoboxing.

## Recap

| Before generics | With generics |
|---|---|
| `List names = new ArrayList();` | `List<String> names = new ArrayList<>();` |
| `String s = (String) names.get(0);` | `String s = names.get(0);` |
| Bugs surface at runtime | Bugs surface at compile time |
| Intent lives in your head/comments | Intent lives in the type, enforced |

---

# Chunk 2 — Generic Classes

## The Problem

You need a small container that holds a value and some metadata. You write:

```java
public class Result {
    private Object value;
    private boolean success;
    private String error;

    public Object getValue() { return value; }
}
```

Every caller now writes `(User) result.getValue()`. You've pushed the casting problem onto everyone who uses your class. Worse — nothing stops a `Result` that was supposed to hold a `User` from holding an `Order`.

## The Concept

A **generic class** declares one or more *type parameters* in angle brackets after the class name.

```java
public class Box<T> {          // T is a type parameter
    private T value;

    public Box(T value) { this.value = value; }

    public T get() { return value; }
    public void set(T value) { this.value = value; }
}
```

`T` is a placeholder. When someone writes `Box<String>`, mentally substitute `String` for every `T`:

```java
Box<String> nameBox = new Box<>("Alice");
String name = nameBox.get();       // returns String — no cast

Box<Integer> ageBox = new Box<>(30);
Integer age = ageBox.get();        // returns Integer

// nameBox.set(42);   ❌ compile error
```

### Vocabulary you need for interviews

```java
public class Box<T> { }            // T = type PARAMETER (the declaration)
Box<String> b;                     // String = type ARGUMENT (the usage)
                                   // Box<String> = PARAMETERIZED TYPE
Box raw;                           // Box = RAW TYPE (legacy, avoid)
```

### Naming conventions (follow these, everyone expects them)

| Letter | Means | Example |
|---|---|---|
| `T` | Type | `Box<T>` |
| `E` | Element | `List<E>`, `Set<E>` |
| `K`, `V` | Key, Value | `Map<K, V>` |
| `R` | Return type | `Function<T, R>` |
| `S`, `U`, `V` | 2nd, 3rd, 4th types | `Triple<T, U, V>` |
| `N` | Number | `NumericBox<N>` |

For domain-specific code, longer names are fine and often clearer: `class Cache<KEY, VALUE>` or `class Repository<ENTITY, ID>`.

## Multiple Type Parameters

```java
public class Pair<K, V> {
    private final K key;
    private final V value;

    public Pair(K key, V value) {
        this.key = key;
        this.value = value;
    }

    public K getKey()   { return key; }
    public V getValue() { return value; }

    // A generic method on a generic class — note it introduces its own <A, B>
    public <A, B> Pair<A, B> mapBoth(Function<K, A> kf, Function<V, B> vf) {
        return new Pair<>(kf.apply(key), vf.apply(value));
    }

    @Override
    public String toString() { return "(" + key + ", " + value + ")"; }
}
```

Usage:

```java
Pair<String, Integer> score = new Pair<>("Alice", 95);
String who = score.getKey();      // String
Integer pts = score.getValue();   // Integer

Pair<Integer, String> flipped = score.mapBoth(String::length, String::valueOf);
```

`Function<K, A>` and `Function<V, B>` here are two ordinary instances of the functional interface [F5](#f5-functional-interfaces-and-lambdas-from-zero) describes — `mapBoth` doesn't know or care whether it's called with a lambda, a method reference, or a hand-written implementation of `Function`; it only cares that whatever it receives has an `apply` method with the right generic signature.

## Real-World Use Case: A Typed API Response Envelope

Nearly every REST backend has this class. Here's the real, production shape of it:

```java
public class ApiResponse<T> {
    private final boolean success;
    private final T data;
    private final String errorCode;
    private final String errorMessage;
    private final Instant timestamp;

    private ApiResponse(boolean success, T data, String errorCode, String errorMessage) {
        this.success = success;
        this.data = data;
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
        this.timestamp = Instant.now();
    }

    // Static factory methods — note they declare their OWN <T>
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null, null);
    }

    public static <T> ApiResponse<T> error(String code, String message) {
        return new ApiResponse<>(false, null, code, message);
    }

    public T getData() { return data; }
    public boolean isSuccess() { return success; }
}
```

Now every controller in your service is type-safe end to end:

```java
@GetMapping("/users/{id}")
public ApiResponse<UserDto> getUser(@PathVariable Long id) {
    return userService.findById(id)
        .map(ApiResponse::ok)
        .orElseGet(() -> ApiResponse.error("USER_NOT_FOUND", "No user " + id));
}

@GetMapping("/orders")
public ApiResponse<List<OrderDto>> listOrders() {
    return ApiResponse.ok(orderService.findAll());
}
```

The consumer of `getUser(...)` gets a `UserDto` back with zero casts, and the compiler guarantees you can't accidentally return an `OrderDto` from the user endpoint.

**Without generics** you'd have written `ApiResponseUserDto`, `ApiResponseOrderDto`, `ApiResponseListOfOrderDto`… one class per payload type. That's the actual alternative, and it's why generics exist.

## Real-World Use Case #2: A Typed Cache

```java
public class TtlCache<K, V> {
    private record Entry<V>(V value, long expiresAt) {}

    private final Map<K, Entry<V>> map = new ConcurrentHashMap<>();
    private final Duration ttl;

    public TtlCache(Duration ttl) { this.ttl = ttl; }

    public Optional<V> get(K key) {
        Entry<V> e = map.get(key);
        if (e == null) return Optional.empty();
        if (System.currentTimeMillis() > e.expiresAt()) {
            map.remove(key);
            return Optional.empty();
        }
        return Optional.of(e.value());
    }

    public void put(K key, V value) {
        map.put(key, new Entry<>(value, System.currentTimeMillis() + ttl.toMillis()));
    }
}
```

One class. Used everywhere:

```java
TtlCache<String, UserProfile> profileCache   = new TtlCache<>(Duration.ofMinutes(5));
TtlCache<Long, List<Permission>> permCache   = new TtlCache<>(Duration.ofMinutes(1));
TtlCache<String, BigDecimal> fxRateCache     = new TtlCache<>(Duration.ofSeconds(30));
```

## "Why can't I just…?"

**"…write `ApiResponse` with an `Object data` field?"**

Then every single controller consumer writes a cast, and the compiler can't verify any of them. And your OpenAPI/Swagger generator can't infer the response schema — it'll document `data: object`. Generics carry into tooling.

**"…write one class per type? It's only a few classes."**

It's never a few. Count the DTOs in a mid-size service: 60–200. Now multiply by every wrapper (`Response`, `Page`, `Optional`, `Either`, `Cache`). You get combinatorial explosion, and every bug fix has to be applied N times.

**"…use inheritance instead — `Box` and `StringBox extends Box`?"**

Inheritance is for *behavior* variation. Generics are for *type* variation. `StringBox` doesn't behave differently from `IntBox`; it just holds a different type. Using inheritance here means duplicating identical code and you *still* can't express `Box<Box<String>>`.

This is exactly [F3](#f3-classes-interfaces-and-inheritance-is-a-overriding-vs-overloading)'s "is-a" test applied to rule out a design, not just explain one: `StringBox` and `IntBox` don't stand in an "is-a" relationship with each other or express any genuine behavioral specialization — inheritance would be modeling a difference that isn't really about behavior at all, only about which type is stored. Generics were built precisely for that axis of variation, which inheritance was never designed to express economically.

## Gotchas

**1. `static` members cannot use the class's type parameters.**

```java
public class Box<T> {
    private static T defaultValue;          // ❌ COMPILE ERROR
    public static void set(T v) { }         // ❌ COMPILE ERROR

    public static <T> Box<T> empty() {      // ✅ OK — this is a NEW T, owned by the method
        return new Box<>(null);
    }
}
```

**Why:** statics belong to the class, not to an instance. There's exactly one `Box.class` at runtime shared by `Box<String>` and `Box<Integer>` — so there's no single `T` for a static to refer to.

This is a direct consequence of [F1](#f1-compile-time-vs-runtime-and-what-the-compiler-actually-does): the compiler erases `Box<T>` to one `Box` class file, and the JVM loads exactly one `Class` object for it (per [F8](#f8-reflection-class-objects-and-introspecting-types-at-runtime)) regardless of how many different `T`s your code parameterizes it with. A `static` field lives on that one shared `Class` object, not on any individual instance — so there is structurally nowhere for "the `T` that this static field holds" to be recorded, because by the time the field exists at runtime, every `T` has already been erased away.

**2. Type parameters are not available at runtime.**

```java
public class Box<T> {
    public T create() {
        return new T();          // ❌ COMPILE ERROR — cannot instantiate T
    }
}
```

Workaround (Chunk 12 covers this properly):
```java
public class Box<T> {
    private final Supplier<T> factory;
    public Box(Supplier<T> factory) { this.factory = factory; }
    public T create() { return factory.get(); }
}
Box<ArrayList<String>> b = new Box<>(ArrayList::new);
```

**3. Always use the diamond `<>` on the right side.**

```java
Map<String, List<Integer>> m = new HashMap<String, List<Integer>>();  // noisy
Map<String, List<Integer>> m = new HashMap<>();                       // ✅ preferred
```

## Recap

- `class Box<T>` declares a type parameter; `Box<String>` supplies a type argument.
- Type parameters can appear in fields, method params, return types, and local variables.
- Static members can't use class-level type parameters — but static *methods* can declare their own.
- The single biggest use case in industry: **wrapper/envelope types** (`ApiResponse<T>`, `Page<T>`, `Result<T>`, `Cache<K,V>`).

---

# Chunk 3 — Generic Methods

## The Problem

You want a utility that returns the first element of any list, or `null` if empty.

```java
public static Object firstOrNull(List list) {
    return list.isEmpty() ? null : list.get(0);
}

String s = (String) firstOrNull(names);   // cast again 😩
```

The class isn't generic — it's a `Utils` class full of statics. You need genericity **on the method itself**.

## The Concept

A **generic method** declares its own type parameters, placed **before the return type**.

```java
//     ↓ type parameter declaration
public static <T> T firstOrNull(List<T> list) {
    return list.isEmpty() ? null : list.get(0);
}
```

Read it left to right: "a static method that, *for any type T*, takes a `List<T>` and returns a `T`."

```java
List<String> names = List.of("Alice", "Bob");
String first = firstOrNull(names);      // T inferred as String — no cast

List<Order> orders = getOrders();
Order o = firstOrNull(orders);          // T inferred as Order
```

The compiler **infers** `T` from the argument. This is called *type inference*.

### The syntax positions — memorize this

```java
public        <T>  T          method(T arg)     { }
//  modifiers  ↑    ↑                ↑
//         declare  return        params
//         type     type
//         params
```

Common mistakes:
```java
public static T <T> firstOrNull(List<T> l) { }   // ❌ wrong order
public static <T> firstOrNull(List<T> l) { }     // ❌ missing return type
public <T> static T firstOrNull(List<T> l) { }   // ❌ modifiers must come first
```

## Generic Methods vs Generic Classes — When to Use Which

| Use a generic **class** | Use a generic **method** |
|---|---|
| The type is part of the object's *state* | The type only matters for one call |
| `Box<T>`, `List<E>`, `Cache<K,V>` | `Collections.sort(...)`, `Arrays.asList(...)` |
| The type persists across method calls | Each call can use a different type |

Rule of thumb: **if the type parameter appears in only one method's signature, make the method generic, not the class.**

```java
// ❌ Over-generic: T only used in one method
public class Validator<T> {
    public boolean isValid(T item) { ... }
    public String getName() { ... }        // doesn't use T
}

// ✅ Better
public class Validator {
    public <T> boolean isValid(T item) { ... }
    public String getName() { ... }
}
```

## Multiple Type Parameters + Relating Them

The power of generic methods is that they let you express **relationships between types**:

```java
public static <K, V> Map<V, K> invert(Map<K, V> source) {
    Map<V, K> result = new HashMap<>();
    for (Map.Entry<K, V> e : source.entrySet()) {
        result.put(e.getValue(), e.getKey());
    }
    return result;
}
```

The signature *guarantees* that the returned map's keys are the source's values. You cannot express that with `Object`.

```java
Map<String, Integer> nameToId = Map.of("alice", 1, "bob", 2);
Map<Integer, String> idToName = invert(nameToId);   // types flow through correctly
```

Another one — mapping a list:

```java
public static <T, R> List<R> map(List<T> source, Function<T, R> fn) {
    List<R> result = new ArrayList<>(source.size());
    for (T item : source) {
        result.add(fn.apply(item));
    }
    return result;
}

List<String> names = List.of("alice", "bob");
List<Integer> lengths = map(names, String::length);   // R inferred as Integer
```

## Explicit Type Witness (when inference fails)

Occasionally the compiler can't figure out `T`. You can tell it explicitly:

```java
// Syntax: receiver.<TypeArgs>methodName(args)
List<String> empty = Collections.<String>emptyList();

// For static methods in the same class you still need a receiver:
List<String> e2 = Utils.<String>firstOrNull(...);      // or this.<String>...
```

When you actually need this:

```java
// Inference from the argument alone is ambiguous
process(Collections.emptyList());     // T inferred as Object — maybe wrong

// Force it
process(Collections.<String>emptyList());
```

In practice, Java 8+ target typing handles most of these, so you'll rarely write a type witness. Know it exists for interviews and for the rare edge case.

## Real-World Use Case: A Retry Utility

Every production codebase has one of these. It must work for *any* return type.

```java
public final class Retry {

    public static <T> T withRetry(int maxAttempts, Duration backoff, Callable<T> action)
            throws Exception {
        Exception last = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return action.call();
            } catch (Exception e) {
                last = e;
                if (attempt < maxAttempts) {
                    Thread.sleep(backoff.toMillis() * attempt);   // linear backoff
                }
            }
        }
        throw last;
    }
}
```

Usage — the return type flows through perfectly:

```java
UserProfile profile = Retry.withRetry(3, Duration.ofMillis(200),
        () -> userClient.fetchProfile(userId));            // returns UserProfile

List<Order> orders = Retry.withRetry(5, Duration.ofSeconds(1),
        () -> orderClient.listOrders(userId));             // returns List<Order>

BigDecimal rate = Retry.withRetry(3, Duration.ofMillis(100),
        () -> fxClient.getRate("USD", "INR"));             // returns BigDecimal
```

**Without generics:** `Object withRetry(...)` and every caller casts. Or you write `retryUser`, `retryOrders`, `retryRate`… one per type. Both are bad.

`Callable<T>` here is another functional interface ([F5](#f5-functional-interfaces-and-lambdas-from-zero)) — its single abstract method is `T call() throws Exception`, and the three lambdas above are three different anonymous implementations of it, each pinning `T` to a different concrete type via target typing.

## Real-World Use Case #2: Null-Safe Defaults

```java
public static <T> T firstNonNull(T a, T b) {
    return a != null ? a : b;
}

public static <T> T requireNonNullElseGet(T value, Supplier<? extends T> supplier) {
    return value != null ? value : supplier.get();
}
```

```java
String region = firstNonNull(request.getRegion(), "us-east-1");
Config cfg    = requireNonNullElseGet(cachedConfig, () -> loadConfigFromDisk());
```

The generic version is checked: `firstNonNull("a", 42)` won't infer a useful type and will be flagged if the target type is `String`.

## Real-World Use Case #3: A Generic Batch Processor

```java
public static <T, R> List<R> processInBatches(
        List<T> items,
        int batchSize,
        Function<List<T>, List<R>> batchProcessor) {

    List<R> results = new ArrayList<>();
    for (int i = 0; i < items.size(); i += batchSize) {
        List<T> batch = items.subList(i, Math.min(i + batchSize, items.size()));
        results.addAll(batchProcessor.apply(batch));
    }
    return results;
}
```

```java
// Bulk-insert 100k rows, 500 at a time — DB has a parameter limit
List<Long> insertedIds = processInBatches(newUsers, 500, jdbcRepo::batchInsert);

// Call an external API that accepts max 100 IDs per request
List<Product> products = processInBatches(productIds, 100, catalogClient::lookupBulk);
```

One utility, works for every entity type in your system.

## "Why can't I just…?"

**"…make the whole class generic instead?"**

If `T` only appears in one method, making the class generic forces every user to pick a `T` at construction time even when it's irrelevant. `Retry<UserProfile> r = new Retry<>()` — now you need a new `Retry` instance per return type. Absurd.

**"…overload the method for each type?"**

```java
public static String firstOrNull(List<String> l) { ... }
public static Integer firstOrNull(List<Integer> l) { ... }   // ❌ won't even compile
```

This is a compile error: *"both me... (222 KB left)
