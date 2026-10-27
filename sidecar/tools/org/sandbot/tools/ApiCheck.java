package org.sandbot.tools;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * API 대조(§2.2-1): 손 구현 클래스의 public·protected API가 실제 SDK와 같은지 클래스 파일로 비교한다.
 *
 * <p>비교하는 것: 클래스 종류·수식어, 상위 형식(제네릭 Signature 포함), 보이는 필드·메서드·생성자 각각의 수식어(public·
 * protected·static·final·abstract·가변 인수)·서술자·제네릭 Signature·throws·상수 값·애너테이션 기본값·런타임에 보이는
 * 애너테이션, enum 상수의 순서, 보이는 중첩 클래스(묶음 안에서 빠지거나 더해진 것). synchronized·native·strictfp·
 * volatile·transient는 구현 세부라 비교하지 않는다. enum의 final·abstract(상수에 본문이 있는지)도 비교하지 않는다.
 *
 * <p>안드로이드 손 구현(android.*)은 실제 SDK가 아니라 android.jar와 비교하고, 일부만 구현해도 된다(있는 멤버만 같아야 한다).
 * SDK에 없는 손 구현 클래스는 org.sandbot.**에 두거나 이름이 Sandbot으로 시작해야 한다.
 *
 * <p>stub 확인에도 쓴다(생성한 stub이 실제 API와 같은지, {@link #compare}).
 */
final class ApiCheck {
    final List<String> errors = new ArrayList<>();
    final List<String> warnings = new ArrayList<>();
    int checkedClasses;
    int checkedConstants;
    int androidPartial;
    /**
     * 비교할 런타임 애너테이션 형식(내부 이름)을 고른다. stub 확인은 가짜 SDK에 없는 형식(Gson 등)의 애너테이션을 뺀다
     * (javac가 쓸 수 없고, 런타임 리플렉션도 없는 형식의 애너테이션은 건너뛴다).
     */
    java.util.function.Predicate<String> annotationFilter = type -> true;

    private static final int CLASS_MASK = ClassFile.ACC_PUBLIC | ClassFile.ACC_PROTECTED | ClassFile.ACC_PRIVATE
            | ClassFile.ACC_STATIC | ClassFile.ACC_FINAL | ClassFile.ACC_INTERFACE | ClassFile.ACC_ABSTRACT
            | ClassFile.ACC_ANNOTATION | ClassFile.ACC_ENUM;
    private static final int FIELD_MASK = ClassFile.ACC_PUBLIC | ClassFile.ACC_PROTECTED | ClassFile.ACC_STATIC
            | ClassFile.ACC_FINAL | ClassFile.ACC_ENUM;
    private static final int METHOD_MASK = ClassFile.ACC_PUBLIC | ClassFile.ACC_PROTECTED | ClassFile.ACC_STATIC
            | ClassFile.ACC_FINAL | ClassFile.ACC_ABSTRACT | ClassFile.ACC_VARARGS;

    /**
     * 손 구현 전체를 대조한다.
     *
     * @param hand 손 구현 클래스(sim 포함 가능 — org.sandbot.**는 건너뛴다)
     * @param handNames 손 구현 클래스 이름
     */
    void checkHand(ClassSource hand, Collection<String> handNames, ClassSource real, ClassSource android,
            Lifter nests) {
        Map<String, List<String>> byNest = new TreeMap<>();
        for (String name : handNames) byNest.computeIfAbsent(nests.nest(hand, name), k -> new ArrayList<>()).add(name);
        Map<String, List<String>> realByNest = new TreeMap<>();
        for (String name : real.names()) {
            String n = nests.nest(real, name);
            if (byNest.containsKey(n)) realByNest.computeIfAbsent(n, k -> new ArrayList<>()).add(name);
        }
        for (Map.Entry<String, List<String>> e : byNest.entrySet()) {
            String nest = e.getKey();
            if (nest.startsWith("org/sandbot/")) continue;
            if (realByNest.containsKey(nest)) {
                compareNest(nest, realByNest.get(nest), real, e.getValue(), hand, true);
            } else if (android.has(nest)) {
                List<String> androidNames = new ArrayList<>();
                for (String name : e.getValue()) if (android.has(name)) androidNames.add(name);
                for (String name : e.getValue()) {
                    ClassFile h = hand.get(name);
                    if (visible(hand, h) && !android.has(name))
                        errors.add(dotted(name) + ": not in the Android API (android.jar); add only real Android types");
                }
                for (String name : androidNames) {
                    ClassFile h = hand.get(name);
                    if (visible(hand, h)) compare(android.get(name), h, false);
                }
            } else {
                String simple = nest.substring(nest.lastIndexOf('/') + 1);
                if (nest.startsWith("android/")) {
                    warnings.add(dotted(nest) + ": not in android.jar (API 16); its API cannot be checked");
                } else if (!simple.startsWith("Sandbot")) {
                    errors.add(dotted(nest) + ": not a class of the FTC SDK. Helper classes in SDK packages must be "
                            + "named Sandbot…, other helpers go in org.sandbot.sdk.**");
                }
            }
        }
    }

    private void compareNest(String nest, List<String> realNames, ClassSource real, List<String> handNames,
            ClassSource hand, boolean exact) {
        Set<String> handSet = new TreeSet<>(handNames);
        Set<String> realSet = new TreeSet<>(realNames);
        for (String name : realNames) {
            ClassFile r = real.get(name);
            if (!visible(real, r)) continue;
            if (!handSet.contains(name) || !visible(hand, hand.get(name))) {
                errors.add(dotted(name) + ": missing in the hand implementation of " + dotted(nest));
                continue;
            }
            compare(r, hand.get(name), exact);
        }
        for (String name : handNames) {
            ClassFile h = hand.get(name);
            if (visible(hand, h) && (!realSet.contains(name) || !visible(real, real.get(name))))
                errors.add(dotted(name) + ": not in the real SDK (hand implementations must not add public or "
                        + "protected classes to SDK types)");
        }
    }

    /** 바깥에서 보이는 클래스인가(public·protected, 감싸는 클래스도 보임, 지역·익명 아님) */
    static boolean visible(ClassSource source, ClassFile file) {
        ClassFile current = file;
        java.util.Set<String> seen = new java.util.HashSet<>();
        while (current != null && seen.add(current.name)) {
            boolean nested = false;
            for (ClassFile.InnerClass entry : current.innerClasses) {
                if (!entry.inner.equals(current.name)) continue;
                nested = true;
                if (entry.outer == null || entry.simpleName == null) return false; // 지역·익명
                if ((entry.access & (ClassFile.ACC_PUBLIC | ClassFile.ACC_PROTECTED)) == 0) return false;
                current = source.get(entry.outer);
                break;
            }
            if (!nested) {
                if (current.enclosingClass != null) return false;
                return (current.access & ClassFile.ACC_PUBLIC) != 0;
            }
        }
        return current != null;
    }

    /**
     * 두 클래스의 보이는 API를 비교한다.
     *
     * @param exact true면 같아야 하고, false(안드로이드 손 구현)면 b가 a의 일부여도 된다
     */
    void compare(ClassFile a, ClassFile b, boolean exact) {
        checkedClasses++;
        String where = dotted(a.name);
        boolean isEnum = (a.access & ClassFile.ACC_ENUM) != 0;
        int classMask = isEnum ? CLASS_MASK & ~(ClassFile.ACC_FINAL | ClassFile.ACC_ABSTRACT) : CLASS_MASK;
        int fa = a.declaredAccess() & classMask;
        int fb = b.declaredAccess() & classMask;
        if (fa != fb) errors.add(where + ": class modifiers " + classFlags(fa) + " (real) vs " + classFlags(fb));
        String sa = supertypes(a);
        String sb = supertypes(b);
        if (!sa.equals(sb)) {
            String message = where + ": supertypes " + sa + " (real) vs " + sb;
            if (exact) errors.add(message);
            else warnings.add(message);
        }
        if (exact) compareAnnotations(where, a.annotations, b.annotations);

        Map<String, ClassFile.Member> fieldsA = visibleMembers(a.fields);
        Map<String, ClassFile.Member> fieldsB = visibleMembers(b.fields);
        for (Map.Entry<String, ClassFile.Member> e : fieldsA.entrySet()) {
            ClassFile.Member fb2 = fieldsB.get(e.getKey());
            String id = where + "." + e.getValue().name;
            if (fb2 == null) {
                if (exact) errors.add(id + ": missing field");
                else androidPartial++;
                continue;
            }
            compareField(id, e.getValue(), fb2, exact);
        }
        for (Map.Entry<String, ClassFile.Member> e : fieldsB.entrySet()) {
            if (!fieldsA.containsKey(e.getKey()))
                errors.add(where + "." + e.getValue().name + ": field not in the real API");
        }
        if (exact && isEnum) {
            List<String> ca = enumConstants(a);
            List<String> cb = enumConstants(b);
            if (!ca.equals(cb)) errors.add(where + ": enum constants " + ca + " (real) vs " + cb);
        }

        Map<String, ClassFile.Member> methodsA = visibleMembers(a.methods);
        Map<String, ClassFile.Member> methodsB = visibleMembers(b.methods);
        for (Map.Entry<String, ClassFile.Member> e : methodsA.entrySet()) {
            ClassFile.Member mb = methodsB.get(e.getKey());
            String id = where + "#" + e.getKey();
            if (mb == null) {
                if (exact) errors.add(id + ": missing method");
                else androidPartial++;
                continue;
            }
            compareMethod(id, e.getValue(), mb, exact, isEnum);
        }
        for (Map.Entry<String, ClassFile.Member> e : methodsB.entrySet()) {
            if (!methodsA.containsKey(e.getKey())) errors.add(where + "#" + e.getKey() + ": method not in the real API");
        }
    }

    private void compareField(String id, ClassFile.Member a, ClassFile.Member b, boolean exact) {
        if ((a.access & FIELD_MASK) != (b.access & FIELD_MASK))
            errors.add(id + ": field modifiers " + memberFlags(a.access & FIELD_MASK, false) + " (real) vs "
                    + memberFlags(b.access & FIELD_MASK, false));
        if (!genericOf(a).equals(genericOf(b))) errors.add(id + ": type " + genericOf(a) + " (real) vs " + genericOf(b));
        if (a.constant != null) checkedConstants++;
        String ca = a.constant == null ? "none" : ClassFile.constantText(a.constant);
        String cb = b.constant == null ? "none" : ClassFile.constantText(b.constant);
        if (!ca.equals(cb)) errors.add(id + ": constant value " + ca + " (real) vs " + cb);
        if (exact) compareAnnotations(id, a.annotations, b.annotations);
    }

    private void compareMethod(String id, ClassFile.Member a, ClassFile.Member b, boolean exact, boolean isEnum) {
        int mask = isEnum ? METHOD_MASK & ~ClassFile.ACC_ABSTRACT : METHOD_MASK;
        if ((a.access & mask) != (b.access & mask))
            errors.add(id + ": modifiers " + memberFlags(a.access & mask, true) + " (real) vs "
                    + memberFlags(b.access & mask, true));
        if (!genericOf(a).equals(genericOf(b)))
            errors.add(id + ": generic signature " + genericOf(a) + " (real) vs " + genericOf(b));
        Set<String> ea = new TreeSet<>(a.exceptions);
        Set<String> eb = new TreeSet<>(b.exceptions);
        if (!ea.equals(eb)) errors.add(id + ": throws " + ea + " (real) vs " + eb);
        String da = String.valueOf(a.annotationDefault);
        String db = String.valueOf(b.annotationDefault);
        if (!da.equals(db)) errors.add(id + ": annotation default " + da + " (real) vs " + db);
        if (exact) compareAnnotations(id, a.annotations, b.annotations);
    }

    private void compareAnnotations(String id, List<String> a, List<String> b) {
        Set<String> sa = filtered(a);
        Set<String> sb = filtered(b);
        if (!sa.equals(sb)) errors.add(id + ": runtime annotations " + sa + " (real) vs " + sb);
    }

    private Set<String> filtered(List<String> annotations) {
        Set<String> result = new TreeSet<>();
        for (String a : annotations) {
            int at = a.indexOf("@L");
            String type = at < 0 ? "" : a.substring(at + 2, a.indexOf(';', at));
            if (annotationFilter.test(type)) result.add(a);
        }
        return result;
    }

    private static Map<String, ClassFile.Member> visibleMembers(List<ClassFile.Member> members) {
        Map<String, ClassFile.Member> map = new LinkedHashMap<>();
        for (ClassFile.Member m : members) {
            if ((m.access & (ClassFile.ACC_PUBLIC | ClassFile.ACC_PROTECTED)) == 0) continue;
            if ((m.access & ClassFile.ACC_SYNTHETIC) != 0) continue;
            // 필드는 이름, 메서드는 이름+서술자로 찾는다(필드 형식이 바뀐 것도 같은 필드로 보고 알린다)
            map.put(m.descriptor.startsWith("(") ? m.name + m.descriptor : m.name, m);
        }
        return map;
    }

    private static List<String> enumConstants(ClassFile file) {
        List<String> names = new ArrayList<>();
        for (ClassFile.Member f : file.fields) if ((f.access & ClassFile.ACC_ENUM) != 0) names.add(f.name);
        return names;
    }

    private static String genericOf(ClassFile.Member m) {
        return m.signature != null ? m.signature : m.descriptor;
    }

    /** 상위 형식(Signature가 있으면 그것, 없으면 같은 모양으로 만든 지움 형식) */
    private static String supertypes(ClassFile file) {
        if (file.signature != null) return file.signature;
        StringBuilder s = new StringBuilder();
        if (file.superName != null) s.append('L').append(file.superName).append(';');
        for (String i : file.interfaces) s.append('L').append(i).append(';');
        return s.toString();
    }

    private static String classFlags(int flags) {
        List<String> words = new ArrayList<>();
        if ((flags & ClassFile.ACC_PUBLIC) != 0) words.add("public");
        if ((flags & ClassFile.ACC_PROTECTED) != 0) words.add("protected");
        if ((flags & ClassFile.ACC_PRIVATE) != 0) words.add("private");
        if ((flags & ClassFile.ACC_STATIC) != 0) words.add("static");
        if ((flags & ClassFile.ACC_FINAL) != 0) words.add("final");
        if ((flags & ClassFile.ACC_ABSTRACT) != 0) words.add("abstract");
        if ((flags & ClassFile.ACC_ANNOTATION) != 0) words.add("@interface");
        else if ((flags & ClassFile.ACC_INTERFACE) != 0) words.add("interface");
        else if ((flags & ClassFile.ACC_ENUM) != 0) words.add("enum");
        else words.add("class");
        return "[" + String.join(" ", words) + "]";
    }

    private static String memberFlags(int flags, boolean method) {
        List<String> words = new ArrayList<>();
        if ((flags & ClassFile.ACC_PUBLIC) != 0) words.add("public");
        if ((flags & ClassFile.ACC_PROTECTED) != 0) words.add("protected");
        if ((flags & ClassFile.ACC_STATIC) != 0) words.add("static");
        if ((flags & ClassFile.ACC_FINAL) != 0) words.add("final");
        if (method && (flags & ClassFile.ACC_ABSTRACT) != 0) words.add("abstract");
        if (method && (flags & ClassFile.ACC_VARARGS) != 0) words.add("varargs");
        if (!method && (flags & ClassFile.ACC_ENUM) != 0) words.add("enum");
        return "[" + String.join(" ", words) + "]";
    }

    static String dotted(String internalName) {
        return internalName.replace('/', '.');
    }

    /**
     * 명령행: ApiCheck --real a.jar[:b.jar…] --android android.jar (--hand 클래스폴더 | --sdk sandbot-sdk.jar)
     *
     * <ul>
     *   <li>--hand: 손 구현 폴더의 클래스(org.sandbot.** 제외)를 대조한다(빌드와 같은 규칙).
     *   <li>--sdk: 실제 SDK의 보이는 클래스마다 빌드한 sdk jar의 같은 클래스(손 구현·들여옴·stub 무엇이든)와 대조한다.
     *       sdk jar에 없는 형식의 애너테이션은 뺀다.
     * </ul>
     * 다르면 종료 코드 1. 마지막 줄: "checked N classes, M constants, E errors".
     */
    public static void main(String[] args) throws Exception {
        Map<String, String> options = new LinkedHashMap<>();
        for (int i = 0; i + 1 < args.length; i += 2) options.put(args[i], args[i + 1]);
        List<ClassSource> realJars = new ArrayList<>();
        for (String path : options.get("--real").split(java.io.File.pathSeparator))
            realJars.add(ClassSource.jar(Paths.get(path)));
        ClassSource real = ClassSource.chain(realJars);
        ClassSource android = ClassSource.jar(Paths.get(options.get("--android")));
        ClassSource jdk = ClassSource.jdk();
        ApiCheck check = new ApiCheck();
        if (options.containsKey("--sdk")) {
            ClassSource sdk = ClassSource.jar(Paths.get(options.get("--sdk")));
            check.annotationFilter = type -> sdk.has(type) || jdk.has(type);
            for (String name : real.names()) {
                ClassFile r = real.get(name);
                if (!visible(real, r)) continue;
                ClassFile mine = sdk.get(name);
                if (mine == null) {
                    check.errors.add(dotted(name) + ": missing in the sdk jar");
                    continue;
                }
                check.compare(r, mine, true);
            }
        } else {
            Path handDir = Paths.get(options.get("--hand"));
            ClassSource hand = ClassSource.directory(handDir);
            check.annotationFilter = type -> hand.has(type) || real.has(type) || jdk.has(type);
            check.checkHand(hand, hand.names(), real, android, new Lifter(hand, real, jdk));
        }
        for (String w : check.warnings) System.out.println("warning: " + w);
        for (String e : check.errors) System.out.println("error: " + e);
        System.out.println("checked " + check.checkedClasses + " classes, " + check.checkedConstants + " constants, "
                + check.errors.size() + " errors");
        System.exit(check.errors.isEmpty() ? 0 : 1);
    }
}
