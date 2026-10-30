package org.sandbot.runtime.patch;

import org.sandbot.testing.Check;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 결정성 패치(라이브러리 L1 §D-3): new HashMap·HashSet → LinkedHashMap·LinkedHashSet, Set.of·Map.of·Collectors 등 →
 * org.sandbot.sim.OrderedCollections. 같은 소스를 패치하지 않은 것(JDK)과 패치한 것으로 돌려
 * <ul>
 *   <li>패치한 쪽은 반복 순서가 넣은 순서이고, 내용은 JDK와 같다
 *   <li>예외는 JDK와 같은 형식·메시지다(NullPointerException은 형식만: JDK의 암시적 NPE 안내문은 다르다)
 *   <li>하위 클래스의 super(...)·익명 하위 클래스는 그대로 HashMap이고, 패치한 클래스는 검증을 통과한다
 * </ul>
 */
public final class OrderedCollectionsTest {
    private OrderedCollectionsTest() {}

    private static final String SOURCE = String.join("\n",
            "import java.util.*;",
            "import java.util.function.*;",
            "import java.util.stream.*;",
            "public class Orders {",
            "  public enum P { ARM, CLAW, LIFT, WRIST, DRIVE, INTAKE, SHOOTER, TURRET, HOOD, FEEDER, CLIMBER, LED,",
            "      CAMERA, GATE, SPINNER, PUSHER }",
            "  public static final class Sub extends HashMap<P, Integer> {",
            "    public Sub() { super(new HashMap<P, Integer>(Collections.singletonMap(P.LED, 1))); put(P.ARM, 2); }",
            "  }",
            "  static String names(Iterable<?> items) {",
            "    StringBuilder b = new StringBuilder();",
            "    for (Object o : items) { if (b.length() > 0) b.append(','); b.append(o); }",
            "    return b.toString();",
            "  }",
            "  static String attempt(Runnable r) {",
            "    try { r.run(); return \"ok\"; }",
            "    catch (NullPointerException e) { return \"NullPointerException\"; }",
            "    catch (RuntimeException e) { return e.getClass().getSimpleName() + \": \" + e.getMessage(); }",
            "  }",
            "  static List<P> all() { return Arrays.asList(P.values()); }",
            "  public static String hashMap() { Map<P, Integer> m = new HashMap<>(); for (P p : P.values()) m.put(p, 1);",
            "    return names(m.keySet()); }",
            "  public static String hashMapCapacity() { Map<P, Integer> m = new HashMap<>(4, 0.5f);",
            "    for (P p : P.values()) m.put(p, 1); return names(new HashMap<>(m).keySet()); }",
            "  public static String hashSets() { Set<P> s = new HashSet<>(32); s.addAll(all());",
            "    Set<P> t = new HashSet<>(8, 1f); t.addAll(all()); return names(s) + '|' + names(t) + '|'",
            "      + names(new HashSet<>(all())); }",
            "  public static String nested() { return names(new HashSet<>(new HashMap<P, Integer>() {{",
            "      for (P p : P.values()) put(p, 1); }}.keySet())); }",
            "  public static String subclass() { Sub s = new Sub(); return names(s.keySet()) + '|' + s.getClass().getSuperclass().getSimpleName(); }",
            "  public static String conditional(boolean flag) { Map<P, Integer> m = flag ? new HashMap<>() : new HashMap<>(4);",
            "    for (P p : P.values()) m.put(p, 1); return names(m.keySet()); }",
            "  public static String constructorRefs() { Supplier<Map<P, Integer>> s = HashMap::new; Map<P, Integer> m = s.get();",
            "    for (P p : P.values()) m.put(p, 1); IntFunction<Set<P>> f = HashSet::new; Set<P> set = f.apply(4);",
            "    set.addAll(all()); return names(m.keySet()) + '|' + names(set); }",
            "  public static String lambda() { Map<Integer, Set<P>> m = new TreeMap<>();",
            "    for (P p : P.values()) m.computeIfAbsent(p.ordinal() % 2, k -> new HashSet<>()).add(p);",
            "    return names(m.get(0)) + '|' + names(m.get(1)); }",
            "  public static String setOf() { return names(Set.of(P.ARM, P.CLAW, P.LIFT)) + '|' + names(Set.of(P.values()))",
            "    + '|' + names(Set.of(P.HOOD)) + '|' + Set.of().size(); }",
            "  public static String mapOf() { return names(Map.of(P.ARM, 1, P.CLAW, 2, P.LIFT, 3, P.WRIST, 4).keySet()) + '|'",
            "    + names(Map.ofEntries(Map.entry(P.GATE, 1), Map.entry(P.ARM, 2), Map.entry(P.LED, 3)).keySet()) + '|'",
            "    + Map.of().size(); }",
            "  public static String copyOf() { Map<P, Integer> m = new LinkedHashMap<>(); for (P p : P.values()) m.put(p, 1);",
            "    return names(Set.copyOf(all())) + '|' + names(Map.copyOf(m).keySet()) + '|'",
            "      + names(Set.copyOf(Arrays.asList(P.LED, P.ARM, P.LED))); }",
            "  public static String collectors() { return names(all().stream().collect(Collectors.toSet())) + '|'",
            "    + names(all().stream().collect(Collectors.toMap(p -> p, p -> 1)).keySet()) + '|'",
            "    + names(all().stream().collect(Collectors.toMap(p -> p, p -> 1, Integer::sum)).keySet()) + '|'",
            "    + names(all().stream().collect(Collectors.toUnmodifiableSet())) + '|'",
            "    + names(all().stream().collect(Collectors.toUnmodifiableMap(p -> p, p -> 1)).keySet()) + '|'",
            "    + names(all().stream().collect(Collectors.toUnmodifiableMap(p -> p, p -> 1, Integer::sum)).keySet()) + '|'",
            "    + names(all().stream().collect(Collectors.groupingBy(p -> p)).keySet()) + '|'",
            "    + names(all().stream().collect(Collectors.groupingBy(p -> p, Collectors.counting())).keySet()); }",
            "  public static String methodRef() { Function<Object[], Set<Object>> f = Set::of;",
            "    return names(f.apply(new Object[] {P.TURRET, P.ARM, P.GATE})); }",
            "  public static String errors() { List<String> out = new ArrayList<>();",
            "    out.add(attempt(() -> Set.of(P.ARM, P.ARM)));",
            "    out.add(attempt(() -> Set.of(P.ARM, P.CLAW, P.ARM, P.LED)));",
            "    out.add(attempt(() -> Set.of((P) null)));",
            "    out.add(attempt(() -> Set.of(P.ARM, null)));",
            "    out.add(attempt(() -> Set.of((P[]) null)));",
            "    out.add(attempt(() -> Map.of(P.ARM, 1, P.ARM, 2)));",
            "    out.add(attempt(() -> Map.of(P.ARM, null)));",
            "    out.add(attempt(() -> Map.ofEntries(Map.entry(P.LED, 1), Map.entry(P.LED, 2))));",
            "    out.add(attempt(() -> Set.copyOf(Arrays.asList(P.ARM, null))));",
            "    out.add(attempt(() -> Map.copyOf(Collections.singletonMap(P.ARM, null))));",
            "    out.add(attempt(() -> Set.of(P.ARM).add(P.LED)));",
            "    out.add(attempt(() -> Set.of(P.ARM).remove(P.LED)));",
            "    out.add(attempt(() -> Set.of(P.ARM).clear()));",
            "    out.add(attempt(() -> Set.of().clear()));",
            "    out.add(attempt(() -> Set.of(P.ARM).iterator().remove()));",
            "    out.add(attempt(() -> Set.of(P.ARM).contains(null)));",
            "    out.add(attempt(() -> Map.of(P.ARM, 1).put(P.LED, 2)));",
            "    out.add(attempt(() -> Map.of(P.ARM, 1).entrySet().iterator().next().setValue(3)));",
            "    out.add(attempt(() -> Map.of(P.ARM, 1).get(null)));",
            "    out.add(attempt(() -> Map.of().containsKey(null)));",
            "    out.add(attempt(() -> Map.of(P.ARM, 1).keySet().remove(P.ARM)));",
            "    out.add(attempt(() -> Stream.of(P.ARM, P.ARM).collect(Collectors.toMap(p -> p, p -> p.ordinal()))));",
            "    out.add(attempt(() -> Stream.of(P.ARM).collect(Collectors.toMap(p -> p, p -> null))));",
            "    out.add(attempt(() -> Stream.of(P.ARM, P.ARM).collect(Collectors.toUnmodifiableMap(p -> p, p -> 1))));",
            "    out.add(attempt(() -> Stream.of(P.ARM, null).collect(Collectors.toUnmodifiableSet())));",
            "    out.add(attempt(() -> Stream.of(P.ARM).collect(Collectors.toUnmodifiableSet()).add(P.LED)));",
            "    out.add(attempt(() -> Stream.of(P.ARM).collect(Collectors.groupingBy(p -> null))));",
            "    out.add(attempt(() -> Collectors.toUnmodifiableMap(null, p -> 1)));",
            "    out.add(String.valueOf(Set.of(P.ARM, P.LED).equals(new HashSet<>(Arrays.asList(P.LED, P.ARM)))));",
            "    out.add(String.valueOf(Map.of(P.ARM, 1).equals(Collections.singletonMap(P.ARM, 1))));",
            "    out.add(String.valueOf(Set.of(P.ARM, P.LED).hashCode() == new HashSet<>(Arrays.asList(P.LED, P.ARM)).hashCode()));",
            "    out.add(Map.of(P.ARM, 1).toString() + Set.of(P.LED).toString());",
            "    return String.join(\";\", out); }",
            "}");

    private static final String[] SCENARIOS = {"hashMap", "hashMapCapacity", "hashSets", "nested", "subclass",
            "conditional", "constructorRefs", "lambda", "setOf", "mapOf", "copyOf", "collectors", "methodRef", "errors"};

    private static final class Loader extends ClassLoader {
        private final Map<String, byte[]> classes;

        Loader(Map<String, byte[]> classes) {
            super(OrderedCollectionsTest.class.getClassLoader());
            this.classes = classes;
        }

        @Override
        protected Class<?> findClass(String name) throws ClassNotFoundException {
            byte[] b = classes.get(name);
            if (b == null) throw new ClassNotFoundException(name);
            return defineClass(name, b, 0, b.length);
        }
    }

    private static Map<String, byte[]> compiled;

    private static synchronized Map<String, byte[]> compiled() throws Exception {
        if (compiled == null) {
            compiled = ClassPatcherTest.compile(Collections.singletonMap("Orders", SOURCE),
                    String.valueOf(Runtime.version().feature()));
        }
        return compiled;
    }

    private static Map<String, byte[]> patched() throws Exception {
        Map<String, byte[]> internal = new HashMap<>();
        for (Map.Entry<String, byte[]> e : compiled().entrySet()) internal.put(e.getKey().replace('.', '/'), e.getValue());
        ClassPatcher patcher = new ClassPatcher(ClassHierarchy.chain(ClassHierarchy.ofClassFiles(internal),
                ClassHierarchy.ofClassLoader(OrderedCollectionsTest.class.getClassLoader())));
        Map<String, byte[]> out = new HashMap<>();
        for (Map.Entry<String, byte[]> e : compiled().entrySet()) out.put(e.getKey(), patcher.apply(e.getValue()).bytes);
        return out;
    }

    private static Map<String, String> run(Map<String, byte[]> classes) throws Exception {
        Class<?> type = Class.forName("Orders", true, new Loader(classes));
        Map<String, String> out = new HashMap<>();
        for (String scenario : SCENARIOS) {
            Method m = null;
            for (Method candidate : type.getMethods()) if (candidate.getName().equals(scenario)) m = candidate;
            out.put(scenario, String.valueOf(m.getParameterCount() == 1 ? m.invoke(null, true) + "/" + m.invoke(null, false)
                    : m.invoke(null)));
        }
        return out;
    }

    private static final String ALL = "ARM,CLAW,LIFT,WRIST,DRIVE,INTAKE,SHOOTER,TURRET,HOOD,FEEDER,CLIMBER,LED,CAMERA,GATE,"
            + "SPINNER,PUSHER";

    /** 쉼표로 나뉜 이름들을 정렬한 것(순서를 빼고 내용만 비교) */
    private static String sorted(String part) {
        List<String> names = new ArrayList<>(Arrays.asList(part.split(",")));
        Collections.sort(names);
        return String.join(",", names);
    }

    private static void sameContents(String jdk, String patched, String what) {
        String[] a = jdk.split("[|/]", -1);
        String[] b = patched.split("[|/]", -1);
        Check.equal(a.length, b.length, what + " parts");
        for (int i = 0; i < a.length; i++) Check.equal(sorted(a[i]), sorted(b[i]), what + " part " + i);
    }

    public static void testInsertionOrderAndSameContentsAsJdk() throws Exception {
        Map<String, String> jdk = run(compiled());
        Map<String, String> ours = run(patched());
        for (String scenario : SCENARIOS) {
            if (!scenario.equals("errors")) sameContents(jdk.get(scenario), ours.get(scenario), scenario);
        }
        Check.equal(ALL, ours.get("hashMap"), "new HashMap()");
        Check.equal(ALL, ours.get("hashMapCapacity"), "new HashMap(int, float), new HashMap(Map)");
        Check.equal(ALL + "|" + ALL + "|" + ALL, ours.get("hashSets"), "new HashSet(int), (int, float), (Collection)");
        Check.equal(ALL + "/" + ALL, ours.get("conditional"), "both branches");
        Check.equal(ALL + "|" + ALL, ours.get("constructorRefs"), "HashMap::new, HashSet::new(int)");
        Check.equal("ARM,LIFT,DRIVE,SHOOTER,HOOD,CLIMBER,CAMERA,SPINNER|CLAW,WRIST,INTAKE,TURRET,FEEDER,LED,GATE,PUSHER",
                ours.get("lambda"), "new HashSet inside a lambda");
        Check.equal("ARM,CLAW,LIFT|" + ALL + "|HOOD|0", ours.get("setOf"), "Set.of");
        Check.equal("ARM,CLAW,LIFT,WRIST|GATE,ARM,LED|0", ours.get("mapOf"), "Map.of, Map.ofEntries");
        Check.equal(ALL + "|" + ALL + "|LED,ARM", ours.get("copyOf"), "Set.copyOf, Map.copyOf");
        Check.equal(String.join("|", Collections.nCopies(8, ALL)), ours.get("collectors"), "Collectors");
        Check.equal("TURRET,ARM,GATE", ours.get("methodRef"), "Set::of (interface static method reference)");
    }

    public static void testExtendsHashMapKeepsItsSuperclass() throws Exception {
        Map<String, String> ours = run(patched());
        // 익명 하위 클래스(new HashMap<>() {{ … }})와 Sub는 HashMap 그대로라 순서는 해시 순서다(new HashSet(…)만 바뀐다)
        String nested = ours.get("nested");
        Check.equal(sorted(ALL), sorted(nested), "anonymous subclass contents");
        String[] subclass = ours.get("subclass").split("\\|");
        Check.equal("HashMap", subclass[1], "Sub still extends HashMap");
        Check.equal("ARM,LED", sorted(subclass[0]), "Sub contents (super(new HashMap(...)))");
        // super(...) 호출은 그대로 HashMap.<init>
        List<String> calls = ClassPatcherTest.invokes(patched().get("Orders$Sub"));
        Check.isTrue(calls.contains("invokespecial java/util/HashMap.<init>(Ljava/util/Map;)V"), "super call kept: " + calls);
        Check.isTrue(calls.contains("invokespecial java/util/LinkedHashMap.<init>(Ljava/util/Map;)V"),
                "argument new HashMap replaced: " + calls);
        List<String> anonymous = ClassPatcherTest.invokes(patched().get("Orders$1"));
        Check.isTrue(anonymous.contains("invokespecial java/util/HashMap.<init>()V"), "anonymous super kept: " + anonymous);
    }

    public static void testExceptionsMatchTheJdk() throws Exception {
        String jdk = run(compiled()).get("errors");
        String ours = run(patched()).get("errors");
        List<String> a = Arrays.asList(jdk.split(";"));
        List<String> b = Arrays.asList(ours.split(";"));
        Check.equal(a.size(), b.size(), "count");
        for (int i = 0; i < a.size(); i++) {
            String expected = a.get(i);
            // toString은 순서만 다를 수 있다(원소 하나라 같다)
            Check.equal(expected, b.get(i), "case " + i + " (JDK " + jdk + ")");
        }
        Check.isTrue(b.get(0).equals("IllegalArgumentException: duplicate element: ARM"), b.get(0));
        Check.isTrue(b.get(5).equals("IllegalArgumentException: duplicate key: ARM"), b.get(5));
        Check.isTrue(b.get(21).startsWith("IllegalStateException: Duplicate key ARM (attempted merging values 0 and 0)"),
                b.get(21));
    }

    public static void testPatchedBytesNameOrderedTypes() throws Exception {
        List<String> calls = ClassPatcherTest.invokes(patched().get("Orders"));
        for (String call : calls) {
            Check.isTrue(!call.equals("invokespecial java/util/HashMap.<init>()V")
                    && !call.startsWith("invokestatic java/util/Set.of") && !call.startsWith("invokestatic java/util/Map.of")
                    && !call.startsWith("invokestatic java/util/stream/Collectors.toSet"), "left unpatched: " + call);
        }
        Check.isTrue(calls.contains("invokestatic org/sandbot/sim/OrderedCollections.setOf(Ljava/lang/Object;"
                + "Ljava/lang/Object;Ljava/lang/Object;)Ljava/util/Set;"), "Set.of(a, b, c): " + calls);
        Check.isTrue(calls.contains("invokestatic org/sandbot/sim/OrderedCollections.toSet()Ljava/util/stream/Collector;"),
                "Collectors.toSet");
        // 대상이 없는 클래스는 같은 배열
        byte[] plain = ClassPatcherTest.compile(Collections.singletonMap("Plain",
                "public class Plain { java.util.Map<String, String> m = new java.util.TreeMap<>(); }"), "8").get("Plain");
        Check.isTrue(ClassPatcher.patch(plain) == plain, "unchanged class is the same array");
        Check.isTrue(ClassPatcher.describeTargets().contains("new java.util.HashMap -> new java.util.LinkedHashMap"),
                "described");
    }

    public static void testNewHashMapFactoriesOnNewerJdks() throws Throwable {
        int feature = Runtime.version().feature();
        if (feature < 19) return;
        String src = "public class Factories { public static String run() { java.util.Map<Integer, Integer> m ="
                + " java.util.HashMap.newHashMap(4); java.util.Set<Integer> s = java.util.HashSet.newHashSet(4);"
                + " for (int i = 40; i > 0; i -= 3) { m.put(i, i); s.add(i); }"
                + " return m.keySet() + \"|\" + s + \"|\" + m.getClass().getSimpleName(); } }";
        Map<String, byte[]> out = ClassPatcherTest.compile(Collections.singletonMap("Factories", src),
                String.valueOf(feature));
        byte[] patched = ClassPatcher.patch(out.get("Factories"));
        Map<String, byte[]> classes = new HashMap<>();
        classes.put("Factories", patched);
        Object result = Class.forName("Factories", true, new Loader(classes)).getMethod("run").invoke(null);
        String order = "[40, 37, 34, 31, 28, 25, 22, 19, 16, 13, 10, 7, 4, 1]";
        Check.equal(order + "|" + order + "|LinkedHashMap", result, "HashMap.newHashMap, HashSet.newHashSet");
    }
}
