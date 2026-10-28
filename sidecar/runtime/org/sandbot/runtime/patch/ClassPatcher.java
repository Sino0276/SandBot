package org.sandbot.runtime.patch;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 클래스 파일의 시간 API 호출을 org.sandbot.sim.TimeRedirects로, 해시 순서 컬렉션을 만드는 호출을 삽입 순서 컬렉션
 * (org.sandbot.sim.OrderedCollections, LinkedHashMap·LinkedHashSet)으로 바꾼다(ASM 없이 직접 고침, spec §2.3, 라이브러리 L1 §D-3).
 *
 * <ul>
 *   <li>상수 풀에 항목을 덧붙이기만 하고 기존 항목의 번호는 바꾸지 않는다.
 *   <li>정적 호출(System.nanoTime, Set.of 등)은 Methodref 항목을 그 자리에서 대리 클래스의 같은 뜻 메서드로 돌린다. 그래서
 *       invokestatic도, 그 항목을 가리키는 MethodHandle(메서드 참조 {@code System::nanoTime})도 함께 바뀐다. 인터페이스의
 *       정적 메서드(Set.of·Map.of)는 InterfaceMethodref라 태그도 Methodref로 바꾼다(대리 클래스는 클래스다, 클래스 파일 52 이상).
 *   <li>인스턴스 호출(obj.wait(t) 등)은 수신 객체를 첫 인수로 받는 정적 메서드로 바꾸고 명령을 같은 길이로 바꾼다:
 *       invokevirtual·invokespecial(3바이트) → invokestatic, invokeinterface(5바이트) → invokestatic + nop nop.
 *       그 항목을 가리키는 MethodHandle(REF_invokeVirtual 등)은 REF_invokeStatic + 새 Methodref로 돌린다.
 *   <li>{@code new java/util/HashMap}·{@code HashSet}과 짝인 {@code invokespecial <init>}은 LinkedHashMap·LinkedHashSet의 같은
 *       서술자 생성자로 바꾼다(메서드마다 new와 그 <init>을 차례대로 짝짓고, 짝이 맞지 않는 메서드는 그대로 둔다). 하위 클래스의
 *       super(...) 호출({@code extends HashMap})은 짝인 new가 없어 바꾸지 않는다. 생성자 참조 {@code HashMap::new}
 *       (REF_newInvokeSpecial MethodHandle)도 바꾼다. 결과는 원래 형식의 하위 클래스라 검증을 통과하고 반복 순서만 삽입 순서가 된다.
 *   <li>코드 길이·오프셋이 그대로라 StackMapTable·예외 표·줄 번호 표를 고치지 않는다.
 * </ul>
 * 바뀐 것이 없으면 받은 배열을 그대로 돌려준다. org.sandbot.sim 클래스(대리 클래스 자신)는 바꾸지 않는다.
 * 남는 구멍(결정적이지 않을 수 있는 것): JDK 내부가 만드는 HashMap(예: Collectors.partitioningBy 밖의 JDK API 결과),
 * IdentityHashMap·WeakHashMap·ConcurrentHashMap·Hashtable, Object.toString·hashCode의 identity 해시 값 자체.
 */
public final class ClassPatcher {
    public static final String REDIRECTS = "org/sandbot/sim/TimeRedirects";
    /** 해시 순서 컬렉션의 삽입 순서 대리 함수(결정성) */
    public static final String ORDERED = "org/sandbot/sim/OrderedCollections";
    /** new로 만들 때 삽입 순서 형식으로 바꾸는 형식(원래 → 바꿀 형식, 둘의 공개 생성자 서술자가 같다) */
    static final Map<String, String> ORDERED_TYPES;
    /** 바꿀 수 있는 생성자 서술자(원래 형식의 공개 생성자) */
    static final Set<String> ORDERED_CONSTRUCTORS;

    static {
        Map<String, String> types = new LinkedHashMap<>();
        types.put("java/util/HashMap", "java/util/LinkedHashMap");
        types.put("java/util/HashSet", "java/util/LinkedHashSet");
        ORDERED_TYPES = Collections.unmodifiableMap(types);
        Set<String> ctors = new LinkedHashSet<>();
        ctors.add("java/util/HashMap()V");
        ctors.add("java/util/HashMap(I)V");
        ctors.add("java/util/HashMap(IF)V");
        ctors.add("java/util/HashMap(Ljava/util/Map;)V");
        ctors.add("java/util/HashSet()V");
        ctors.add("java/util/HashSet(I)V");
        ctors.add("java/util/HashSet(IF)V");
        ctors.add("java/util/HashSet(Ljava/util/Collection;)V");
        ORDERED_CONSTRUCTORS = Collections.unmodifiableSet(ctors);
    }

    /** 수신 형식(owner)을 어떻게 맞추나 */
    enum Match {
        /** 이 클래스만(final 클래스, private 생성자) */
        EXACT,
        /** 이 클래스와, 그 메서드를 다시 선언하지 않은 하위 클래스(javac는 Worker.sleep(10)을 Worker.sleep으로 적는다) */
        SUBCLASS,
        /** 아무 형식(Object의 final 메서드 wait: 어떤 클래스·인터페이스·배열로도 부를 수 있고 다시 선언할 수 없다) */
        ANY
    }

    static final class Target {
        final String owner;
        final String name;
        final String desc;
        final boolean isStatic;
        /** 인터페이스의 정적 메서드(Set.of 등): InterfaceMethodref로만 부른다 */
        final boolean ownerIsInterface;
        final Match match;
        /** 대리 클래스(TimeRedirects 또는 OrderedCollections) */
        final String redirectClass;
        final String newName;
        final String newDesc;

        Target(String owner, String name, String desc, boolean isStatic, Match match, String newName) {
            this(owner, name, desc, isStatic, false, match, REDIRECTS, newName);
        }

        Target(String owner, String name, String desc, boolean isStatic, boolean ownerIsInterface, Match match,
                String redirectClass, String newName) {
            this.owner = owner;
            this.name = name;
            this.desc = desc;
            this.isStatic = isStatic;
            this.ownerIsInterface = ownerIsInterface;
            this.match = match;
            this.redirectClass = redirectClass;
            this.newName = newName;
            // 인스턴스 메서드는 수신 객체를 첫 인수로 받는다
            this.newDesc = isStatic ? desc : "(L" + (match == Match.ANY ? "java/lang/Object" : owner) + ";" + desc.substring(1);
        }

        @Override
        public String toString() {
            return owner.replace('/', '.') + "." + name + desc;
        }
    }

    /** 해시 순서 컬렉션을 만드는 정적 메서드 → OrderedCollections(같은 서술자) */
    private static void ordered(List<Target> t, String owner, boolean isInterface, String name, String desc,
            String newName) {
        t.add(new Target(owner, name, desc, true, isInterface, Match.EXACT, ORDERED, newName));
    }

    /** 바꾸는 대상 표(spec §2.3). TimeRedirects에 newName·newDesc 메서드가 모두 있어야 한다(테스트가 확인). */
    static final List<Target> TARGETS;

    static {
        List<Target> t = new ArrayList<>();
        String system = "java/lang/System";
        t.add(new Target(system, "nanoTime", "()J", true, Match.EXACT, "nanoTime"));
        t.add(new Target(system, "currentTimeMillis", "()J", true, Match.EXACT, "currentTimeMillis"));
        t.add(new Target(system, "exit", "(I)V", true, Match.EXACT, "exit"));
        String thread = "java/lang/Thread";
        t.add(new Target(thread, "sleep", "(J)V", true, Match.SUBCLASS, "sleep"));
        t.add(new Target(thread, "sleep", "(JI)V", true, Match.SUBCLASS, "sleep"));
        t.add(new Target(thread, "sleep", "(Ljava/time/Duration;)V", true, Match.SUBCLASS, "sleep"));
        t.add(new Target(thread, "join", "(J)V", false, Match.SUBCLASS, "join"));
        t.add(new Target(thread, "join", "(JI)V", false, Match.SUBCLASS, "join"));
        t.add(new Target("java/lang/Object", "wait", "(J)V", false, Match.ANY, "wait"));
        t.add(new Target("java/lang/Object", "wait", "(JI)V", false, Match.ANY, "wait"));
        t.add(new Target("java/util/concurrent/TimeUnit", "sleep", "(J)V", false, Match.EXACT, "sleep"));
        String lockSupport = "java/util/concurrent/locks/LockSupport";
        t.add(new Target(lockSupport, "parkNanos", "(J)V", true, Match.EXACT, "parkNanos"));
        t.add(new Target(lockSupport, "parkNanos", "(Ljava/lang/Object;J)V", true, Match.EXACT, "parkNanos"));
        t.add(new Target(lockSupport, "parkUntil", "(J)V", true, Match.EXACT, "parkUntil"));
        t.add(new Target(lockSupport, "parkUntil", "(Ljava/lang/Object;J)V", true, Match.EXACT, "parkUntil"));
        t.add(new Target("java/time/Instant", "now", "()Ljava/time/Instant;", true, Match.EXACT, "instantNow"));
        t.add(new Target("java/time/Clock", "systemUTC", "()Ljava/time/Clock;", true, Match.SUBCLASS, "clockSystemUTC"));
        t.add(new Target("java/time/Clock", "systemDefaultZone", "()Ljava/time/Clock;", true, Match.SUBCLASS,
                "clockSystemDefaultZone"));
        t.add(new Target("java/time/LocalDateTime", "now", "()Ljava/time/LocalDateTime;", true, Match.EXACT,
                "localDateTimeNow"));
        t.add(new Target("java/time/LocalDate", "now", "()Ljava/time/LocalDate;", true, Match.EXACT, "localDateNow"));
        t.add(new Target("java/time/LocalTime", "now", "()Ljava/time/LocalTime;", true, Match.EXACT, "localTimeNow"));
        t.add(new Target("java/time/ZonedDateTime", "now", "()Ljava/time/ZonedDateTime;", true, Match.EXACT,
                "zonedDateTimeNow"));
        t.add(new Target("java/time/OffsetDateTime", "now", "()Ljava/time/OffsetDateTime;", true, Match.EXACT,
                "offsetDateTimeNow"));
        String runtime = "java/lang/Runtime";
        t.add(new Target(runtime, "exit", "(I)V", false, Match.EXACT, "runtimeExit"));
        t.add(new Target(runtime, "halt", "(I)V", false, Match.EXACT, "runtimeHalt"));

        // 결정성(삽입 순서): Set.of·Map.of(JDK가 JVM마다 SALT로 섞음), Collectors(HashSet·HashMap)
        String obj = "Ljava/lang/Object;";
        for (int n = 0; n <= 10; n++) {
            ordered(t, "java/util/Set", true, "of", "(" + obj.repeat(n) + ")Ljava/util/Set;", "setOf");
            ordered(t, "java/util/Map", true, "of", "(" + obj.repeat(2 * n) + ")Ljava/util/Map;", "mapOf");
        }
        ordered(t, "java/util/Set", true, "of", "([Ljava/lang/Object;)Ljava/util/Set;", "setOf");
        ordered(t, "java/util/Set", true, "copyOf", "(Ljava/util/Collection;)Ljava/util/Set;", "setCopyOf");
        ordered(t, "java/util/Map", true, "ofEntries", "([Ljava/util/Map$Entry;)Ljava/util/Map;", "mapOfEntries");
        ordered(t, "java/util/Map", true, "copyOf", "(Ljava/util/Map;)Ljava/util/Map;", "mapCopyOf");
        ordered(t, "java/util/HashMap", false, "newHashMap", "(I)Ljava/util/HashMap;", "newHashMap");
        ordered(t, "java/util/HashSet", false, "newHashSet", "(I)Ljava/util/HashSet;", "newHashSet");
        String collectors = "java/util/stream/Collectors";
        String collector = ")Ljava/util/stream/Collector;";
        String function = "Ljava/util/function/Function;";
        String merge = "Ljava/util/function/BinaryOperator;";
        ordered(t, collectors, false, "toSet", "(" + collector, "toSet");
        ordered(t, collectors, false, "toMap", "(" + function + function + collector, "toMap");
        ordered(t, collectors, false, "toMap", "(" + function + function + merge + collector, "toMap");
        ordered(t, collectors, false, "toUnmodifiableSet", "(" + collector, "toUnmodifiableSet");
        ordered(t, collectors, false, "toUnmodifiableMap", "(" + function + function + collector,
                "toUnmodifiableMap");
        ordered(t, collectors, false, "toUnmodifiableMap", "(" + function + function + merge + collector,
                "toUnmodifiableMap");
        ordered(t, collectors, false, "groupingBy", "(" + function + collector, "groupingBy");
        ordered(t, collectors, false, "groupingBy", "(" + function + "Ljava/util/stream/Collector;" + collector,
                "groupingBy");
        TARGETS = Collections.unmodifiableList(t);
    }

    /** 패치 결과(바뀐 호출 자리 수와 바꾼 대상) */
    public static final class Result {
        public final byte[] bytes;
        /** 바꾼 명령 수(정적 호출의 invokestatic은 항목만 바꾸므로 세지 않는다) */
        public final int instructions;
        /** 바꾼 대상(예: "java.lang.System.nanoTime()J"), 상수 풀 순서 */
        public final List<String> redirected;

        Result(byte[] bytes, int instructions, List<String> redirected) {
            this.bytes = bytes;
            this.instructions = instructions;
            this.redirected = Collections.unmodifiableList(redirected);
        }

        public boolean changed() {
            return !redirected.isEmpty();
        }
    }

    private final ClassHierarchy hierarchy;

    public ClassPatcher(ClassHierarchy hierarchy) {
        this.hierarchy = hierarchy;
    }

    /**
     * 상속 관계는 시스템 클래스 로더로 찾는다(JDK 클래스와 같은 클래스 경로의 클래스). 바뀐 것이 없으면 같은 배열.
     */
    public static byte[] patch(byte[] classFile) throws PatchException {
        return new ClassPatcher(ClassHierarchy.ofClassLoader(ClassLoader.getSystemClassLoader())).apply(classFile).bytes;
    }

    public Result apply(byte[] bytes) throws PatchException {
        ClassFile cf = new ClassFile(bytes);
        if (cf.thisName.startsWith("org/sandbot/sim/")) return new Result(bytes, 0, new ArrayList<>());
        ClassInfo self = new ClassInfo(cf.thisName, cf.superName, (cf.accessFlags & ClassFile.ACC_INTERFACE) != 0,
                cf.methods);
        ClassHierarchy h = name -> name.equals(self.name) ? self : hierarchy.lookup(name);

        // 1. 바꿀 Methodref·InterfaceMethodref 찾기(그리고 new로 바꿀 HashMap·HashSet의 Class·<init> 항목)
        Map<Integer, Target> staticRefs = new LinkedHashMap<>();
        Map<Integer, Target> instanceRefs = new LinkedHashMap<>();
        Map<Integer, String> orderedClasses = new LinkedHashMap<>();
        Map<Integer, String[]> orderedInits = new LinkedHashMap<>();
        for (int i = 1; i < cf.cpCount; i++) {
            if (cf.cpOffset[i] == 0) continue;
            int tag = cf.tag(i);
            if (tag == ClassFile.CLASS) {
                String name = cf.className(i);
                if (ORDERED_TYPES.containsKey(name)) orderedClasses.put(i, name);
                continue;
            }
            if (tag != ClassFile.METHODREF && tag != ClassFile.INTERFACE_METHODREF) continue;
            int off = cf.cpOffset[i];
            String owner = cf.className(cf.u2(off + 1));
            int nat = cf.u2(off + 3);
            if (cf.tag(nat) != ClassFile.NAME_AND_TYPE) throw new PatchException("bad NameAndType at entry " + nat);
            String name = cf.utf8(cf.u2(cf.cpOffset[nat] + 1));
            String desc = cf.utf8(cf.u2(cf.cpOffset[nat] + 3));
            if (tag == ClassFile.METHODREF && name.equals("<init>") && ORDERED_TYPES.containsKey(owner)) {
                orderedInits.put(i, new String[] {owner, desc});
                continue;
            }
            Target target = find(owner, name, desc, tag == ClassFile.INTERFACE_METHODREF, h);
            if (target == null) continue;
            (target.isStatic ? staticRefs : instanceRefs).put(i, target);
        }
        // new HashMap·HashSet과 그 <init>의 짝(메서드마다, 바이트코드 위치)
        List<int[]> orderedPairs = new ArrayList<>();
        if (!orderedClasses.isEmpty() && !orderedInits.isEmpty()) {
            for (int[] range : cf.codeRanges)
                pairConstructions(bytes, range[0], range[1], orderedClasses, orderedInits, orderedPairs);
        }
        // 생성자 참조 HashMap::new(REF_newInvokeSpecial = 8)
        List<Integer> orderedHandles = new ArrayList<>();
        for (int i = 1; i < cf.cpCount && !orderedInits.isEmpty(); i++) {
            if (cf.cpOffset[i] == 0 || cf.tag(i) != ClassFile.METHOD_HANDLE) continue;
            int off = cf.cpOffset[i];
            if (cf.u1(off + 1) == 8 && constructorReplaceable(orderedInits.get(cf.u2(off + 2)))) orderedHandles.add(i);
        }
        if (staticRefs.isEmpty() && instanceRefs.isEmpty() && orderedPairs.isEmpty() && orderedHandles.isEmpty())
            return new Result(bytes, 0, new ArrayList<>());

        // 2. 새 상수 풀 항목
        Appender cp = new Appender(cf.cpCount);
        byte[] out = bytes.clone();
        Set<String> redirected = new LinkedHashSet<>();
        for (Map.Entry<Integer, Target> e : staticRefs.entrySet()) {
            Target t = e.getValue();
            int off = cf.cpOffset[e.getKey()];
            // 인터페이스의 정적 메서드(InterfaceMethodref)는 클래스의 메서드가 되므로 태그도 Methodref로
            out[off] = (byte) ClassFile.METHODREF;
            put2(out, off + 1, cp.classEntry(t.redirectClass));
            put2(out, off + 3, cp.nameAndType(t.newName, t.newDesc));
            redirected.add(t.toString());
        }
        Map<Integer, Integer> instanceNew = new LinkedHashMap<>();
        for (Map.Entry<Integer, Target> e : instanceRefs.entrySet()) {
            Target t = e.getValue();
            instanceNew.put(e.getKey(), cp.methodref(cp.classEntry(t.redirectClass), t.newName, t.newDesc));
            redirected.add(t.toString());
        }

        // 3. 인스턴스 호출 명령 바꾸기
        int instructions = 0;
        if (!instanceNew.isEmpty()) {
            for (int[] range : cf.codeRanges) instructions += rewriteCode(out, range[0], range[1], instanceNew);
            // MethodHandle 상수(메서드 참조 obj::wait 등)
            for (int i = 1; i < cf.cpCount; i++) {
                if (cf.cpOffset[i] == 0 || cf.tag(i) != ClassFile.METHOD_HANDLE) continue;
                int off = cf.cpOffset[i];
                int kind = cf.u1(off + 1);
                Integer replacement = instanceNew.get(cf.u2(off + 2));
                if (replacement == null) continue;
                // REF_invokeVirtual(5)·REF_invokeSpecial(7)·REF_invokeInterface(9) → REF_invokeStatic(6)
                if (kind == 5 || kind == 7 || kind == 9) {
                    out[off + 1] = 6;
                    put2(out, off + 2, replacement);
                }
            }
        }

        // 4. new HashMap·HashSet → LinkedHashMap·LinkedHashSet(짝인 <init>과 함께), 생성자 참조 HashMap::new
        for (int[] pair : orderedPairs) {
            String[] init = orderedInits.get(pair[2]);
            int linked = cp.classEntry(ORDERED_TYPES.get(init[0]));
            put2(out, pair[0] + 1, linked);
            put2(out, pair[1] + 1, cp.methodref(linked, "<init>", init[1]));
            instructions += 2;
            redirected.add("new " + init[0].replace('/', '.') + init[1]);
        }
        for (int i : orderedHandles) {
            int off = cf.cpOffset[i];
            String[] init = orderedInits.get(cf.u2(off + 2));
            put2(out, off + 2, cp.methodref(cp.classEntry(ORDERED_TYPES.get(init[0])), "<init>", init[1]));
            redirected.add(init[0].replace('/', '.') + "::new" + init[1]);
        }

        int newCount = cp.nextIndex;
        if (newCount > 0xFFFF)
            throw new PatchException("constant pool would exceed 65535 entries (" + newCount + ")");

        ByteArrayOutputStream result = new ByteArrayOutputStream(bytes.length + cp.bytes.size());
        result.write(out, 0, 8);
        result.write(newCount >> 8);
        result.write(newCount & 0xFF);
        result.write(out, 10, cf.cpEnd - 10);
        result.write(cp.bytes.toByteArray(), 0, cp.bytes.size());
        result.write(out, cf.cpEnd, out.length - cf.cpEnd);
        return new Result(result.toByteArray(), instructions, new ArrayList<>(redirected));
    }

    private static Target find(String owner, String name, String desc, boolean interfaceRef, ClassHierarchy h) {
        for (Target t : TARGETS) {
            if (!t.name.equals(name) || !t.desc.equals(desc)) continue;
            // 정적 대상은 클래스의 메서드(Methodref)이거나 인터페이스의 정적 메서드(InterfaceMethodref)다
            if (t.isStatic && interfaceRef != t.ownerIsInterface) continue;
            if (ownerMatches(owner, t, h)) return t;
        }
        return null;
    }

    private static boolean constructorReplaceable(String[] init) {
        return init != null && ORDERED_CONSTRUCTORS.contains(init[0] + init[1]);
    }

    /**
     * 메서드 하나의 바이트코드 [start, end)에서 {@code new HashMap}·{@code new HashSet}과 그 객체를 초기화하는
     * {@code invokespecial <init>}을 짝짓는다. javac·kotlinc는 {@code new X; dup; 인수; invokespecial X.<init>}을 차례대로(중첩은
     * 안쪽부터) 쓰므로, 앞에서부터 보며 new를 쌓고 같은 형식의 <init>을 만나면 맨 위 new와 짝짓는다. 쌓인 new가 없을 때의 <init>은
     * 하위 클래스 생성자의 super(...)·this(...)라 그대로 둔다. 짝이 맞지 않거나(다른 형식의 new가 맨 위, 끝까지 짝이 없는 new)
     * 바꿀 수 없는 생성자가 있으면 이 메서드의 짝은 하나도 넣지 않는다(바꾸지 않으면 검증은 그대로 통과한다).
     *
     * @param pairs 결과에 더한다: {new 위치, invokespecial 위치, Methodref 번호}
     */
    private static void pairConstructions(byte[] code, int start, int end, Map<Integer, String> classes,
            Map<Integer, String[]> inits, List<int[]> pairs) throws PatchException {
        List<int[]> pending = new ArrayList<>();
        List<int[]> found = new ArrayList<>();
        boolean consistent = true;
        int pc = start;
        while (pc < end) {
            int op = code[pc] & 0xFF;
            if (op == 0xBB || op == 0xB7) {
                int index = ((code[pc + 1] & 0xFF) << 8) | (code[pc + 2] & 0xFF);
                if (op == 0xBB) {
                    if (classes.containsKey(index)) pending.add(new int[] {pc, index});
                } else {
                    String[] init = inits.get(index);
                    if (init != null && !pending.isEmpty()) {
                        int[] top = pending.remove(pending.size() - 1);
                        if (!classes.get(top[1]).equals(init[0]) || !constructorReplaceable(init)) consistent = false;
                        else found.add(new int[] {top[0], pc, index});
                    }
                }
            }
            int length = instructionLength(code, pc, start);
            if (length <= 0 || pc + length > end) throw new PatchException("bad bytecode at offset " + (pc - start));
            pc += length;
        }
        if (consistent && pending.isEmpty()) pairs.addAll(found);
    }

    private static boolean ownerMatches(String owner, Target t, ClassHierarchy h) {
        if (t.match == Match.ANY || owner.equals(t.owner)) return true;
        if (t.match == Match.EXACT) return false;
        String c = owner;
        for (int depth = 0; depth < 100; depth++) {
            ClassInfo info = h.lookup(c);
            // 모르는 클래스면 바꾸지 않는다(그 클래스가 같은 이름의 다른 메서드를 가질 수 있다)
            if (info == null || info.isInterface) return false;
            if (info.declares(t.name, t.desc)) return false;
            c = info.superName;
            if (c == null) return false;
            if (c.equals(t.owner)) return true;
        }
        return false;
    }

    /** 바이트코드 [start, end)에서 instanceNew의 항목을 부르는 invokevirtual·invokespecial·invokeinterface를 바꾼다 */
    private static int rewriteCode(byte[] code, int start, int end, Map<Integer, Integer> instanceNew)
            throws PatchException {
        int count = 0;
        int pc = start;
        while (pc < end) {
            int op = code[pc] & 0xFF;
            if (op == 0xB6 || op == 0xB7 || op == 0xB9) {
                int index = ((code[pc + 1] & 0xFF) << 8) | (code[pc + 2] & 0xFF);
                Integer replacement = instanceNew.get(index);
                if (replacement != null) {
                    code[pc] = (byte) 0xB8;
                    put2(code, pc + 1, replacement);
                    if (op == 0xB9) {
                        code[pc + 3] = 0;
                        code[pc + 4] = 0;
                    }
                    count++;
                }
            }
            int length = instructionLength(code, pc, start);
            if (length <= 0 || pc + length > end) throw new PatchException("bad bytecode at offset " + (pc - start));
            pc += length;
        }
        return count;
    }

    /** JVMS 6.5의 명령 길이(오퍼랜드 포함). 0이면 모르는 opcode. */
    static int instructionLength(byte[] code, int pc, int codeStart) {
        int op = code[pc] & 0xFF;
        if (op <= 0x0F) return 1;
        switch (op) {
            case 0x10: // bipush
            case 0x12: // ldc
            case 0xA9: // ret
            case 0xBC: // newarray
                return 2;
            case 0x11: // sipush
            case 0x13: // ldc_w
            case 0x14: // ldc2_w
            case 0x84: // iinc
                return 3;
            case 0xAA: { // tableswitch
                int p = align(pc + 1, codeStart);
                int low = s4(code, p + 4);
                int high = s4(code, p + 8);
                long n = (long) high - low + 1;
                if (n < 0 || n > 0xFFFF) return 0;
                return (int) (p - pc + 12 + n * 4);
            }
            case 0xAB: { // lookupswitch
                int p = align(pc + 1, codeStart);
                int pairs = s4(code, p + 4);
                if (pairs < 0 || pairs > 0xFFFF) return 0;
                return p - pc + 8 + pairs * 8;
            }
            case 0xB9: // invokeinterface
            case 0xBA: // invokedynamic
            case 0xC8: // goto_w
            case 0xC9: // jsr_w
                return 5;
            case 0xC5: // multianewarray
                return 4;
            case 0xC4: // wide
                return (code[pc + 1] & 0xFF) == 0x84 ? 6 : 4;
            default:
                break;
        }
        if (op >= 0x15 && op <= 0x19) return 2; // iload..aload
        if (op >= 0x1A && op <= 0x35) return 1; // xload_n, xaload
        if (op >= 0x36 && op <= 0x3A) return 2; // istore..astore
        if (op >= 0x3B && op <= 0x83) return 1; // xstore_n, xastore, 스택·산술
        if (op >= 0x85 && op <= 0x98) return 1; // 변환·비교
        if (op >= 0x99 && op <= 0xA8) return 3; // if*, goto, jsr
        if (op >= 0xAC && op <= 0xB1) return 1; // return
        if (op >= 0xB2 && op <= 0xB8) return 3; // 필드, invokevirtual·special·static
        if (op == 0xBB || op == 0xBD || op == 0xC0 || op == 0xC1 || op == 0xC6 || op == 0xC7) return 3;
        if (op == 0xBE || op == 0xBF || op == 0xC2 || op == 0xC3) return 1;
        return 0;
    }

    private static int align(int p, int codeStart) {
        int rel = p - codeStart;
        return codeStart + ((rel + 3) & ~3);
    }

    private static int s4(byte[] b, int p) {
        return ((b[p] & 0xFF) << 24) | ((b[p + 1] & 0xFF) << 16) | ((b[p + 2] & 0xFF) << 8) | (b[p + 3] & 0xFF);
    }

    private static void put2(byte[] b, int p, int v) {
        b[p] = (byte) (v >> 8);
        b[p + 1] = (byte) v;
    }

    /** 상수 풀 끝에 덧붙일 항목(같은 것은 한 번만) */
    private static final class Appender {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int nextIndex;
        private final Map<String, Integer> utf8 = new LinkedHashMap<>();
        private final Map<String, Integer> classes = new LinkedHashMap<>();
        private final Map<String, Integer> nats = new LinkedHashMap<>();
        private final Map<String, Integer> methodrefs = new LinkedHashMap<>();

        Appender(int firstIndex) {
            this.nextIndex = firstIndex;
        }

        int utf8(String s) {
            Integer index = utf8.get(s);
            if (index != null) return index;
            byte[] encoded = ClassFile.encodeModifiedUtf8(s);
            bytes.write(ClassFile.UTF8);
            write2(encoded.length);
            bytes.write(encoded, 0, encoded.length);
            utf8.put(s, nextIndex);
            return nextIndex++;
        }

        int classEntry(String internalName) {
            Integer index = classes.get(internalName);
            if (index != null) return index;
            int name = utf8(internalName);
            bytes.write(ClassFile.CLASS);
            write2(name);
            classes.put(internalName, nextIndex);
            return nextIndex++;
        }

        int nameAndType(String name, String desc) {
            String key = name + desc;
            Integer index = nats.get(key);
            if (index != null) return index;
            int n = utf8(name);
            int d = utf8(desc);
            bytes.write(ClassFile.NAME_AND_TYPE);
            write2(n);
            write2(d);
            nats.put(key, nextIndex);
            return nextIndex++;
        }

        int methodref(int classIndex, String name, String desc) {
            String key = classIndex + "." + name + desc;
            Integer index = methodrefs.get(key);
            if (index != null) return index;
            int nat = nameAndType(name, desc);
            bytes.write(ClassFile.METHODREF);
            write2(classIndex);
            write2(nat);
            methodrefs.put(key, nextIndex);
            return nextIndex++;
        }

        private void write2(int v) {
            bytes.write(v >> 8);
            bytes.write(v & 0xFF);
        }
    }

    /** 대상 표를 사람이 읽는 글자로(문서·진단용) */
    public static List<String> describeTargets() {
        List<String> out = new ArrayList<>();
        for (Target t : TARGETS) out.add(t + " -> " + t.redirectClass.replace('/', '.') + "." + t.newName + t.newDesc);
        for (Map.Entry<String, String> e : ORDERED_TYPES.entrySet())
            out.add("new " + e.getKey().replace('/', '.') + " -> new " + e.getValue().replace('/', '.'));
        return out;
    }
}
