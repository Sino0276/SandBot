package org.sandbot.tools;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * 들여오기(§2.2-2): 실제 SDK 클래스 중 참조가 JDK·손 구현·다른 들여온 클래스로만 닫히는 것을 고른다.
 *
 * <p>단위는 최상위 클래스와 그 중첩·지역·익명 클래스 전체(이하 묶음)다. 묶음 안 클래스 하나라도 닫히지 않으면 묶음 전체를
 * 들여오지 않는다. 그래야 최상위 하나가 손 구현·들여옴·stub 중 하나로만 정해지고, stub 소스가 들여온 클래스와 섞이지 않는다.
 *
 * <p>닫힘은 최대 고정점이다: 모든 후보에서 시작해, 닫히지 않는 참조(없는 클래스, 없는 멤버, static 여부·접근이 맞지 않는
 * 멤버)가 있는 묶음과 빠진 묶음을 쓰는 묶음을 차례로 뺀다. 멤버는 상위 클래스·인터페이스를 따라 찾는다(JVMS 5.4.3).
 */
final class Lifter {
    /** 손 구현(sim 포함) 클래스 */
    private final ClassSource hand;
    /** 실제 SDK 클래스 */
    private final ClassSource real;
    private final ClassSource jdk;
    private final Set<String> handNests = new TreeSet<>();
    /** 후보 묶음 → 그 묶음의 클래스 */
    final Map<String, List<String>> candidates = new TreeMap<>();
    /** 묶음마다 직접 막는 이유(열쇠 → 설명). 열쇠는 없는 클래스 이름이나 멤버 소유 클래스. */
    final Map<String, Map<String, String>> hardFailures = new TreeMap<>();
    /** 묶음마다 쓰는 다른 후보 묶음 */
    final Map<String, Set<String>> nestDeps = new TreeMap<>();
    /** 결과: 들여올 묶음 */
    Set<String> lifted;
    /** 들여오지 않는 묶음 → 첫 이유(사람이 읽는 글자) */
    final Map<String, String> blockedReason = new TreeMap<>();

    private final Map<String, String> nestOf = new HashMap<>();

    Lifter(ClassSource hand, ClassSource real, ClassSource jdk) {
        this.hand = hand;
        this.real = real;
        this.jdk = jdk;
    }

    /** 최상위 클래스(묶음 이름). InnerClasses·EnclosingMethod로 따라가고, 모르면 '$' 앞. */
    String nest(ClassSource source, String name) {
        String key = System.identityHashCode(source) + ":" + name;
        String cached = nestOf.get(key);
        if (cached != null) return cached;
        String current = name;
        Set<String> seen = new HashSet<>();
        while (seen.add(current)) {
            ClassFile file = source.get(current);
            String outer = file == null ? null : file.outerClass();
            if (outer == null) {
                if (file == null && current.indexOf('$') > 0) current = current.substring(0, current.indexOf('$'));
                break;
            }
            current = outer;
        }
        nestOf.put(key, current);
        return current;
    }

    void run() {
        for (String name : hand.names()) handNests.add(nest(hand, name));
        for (String name : real.names()) {
            String n = nest(real, name);
            if (handNests.contains(n)) continue;
            candidates.computeIfAbsent(n, k -> new ArrayList<>()).add(name);
        }
        for (Map.Entry<String, List<String>> e : candidates.entrySet()) {
            Map<String, String> failures = new TreeMap<>();
            Set<String> deps = new TreeSet<>();
            for (String name : e.getValue()) analyze(real.get(name), e.getKey(), failures, deps);
            hardFailures.put(e.getKey(), failures);
            nestDeps.put(e.getKey(), deps);
        }
        lifted = fixpoint(Collections.<String>emptySet(), Collections.<String>emptySet(), blockedReason);
    }

    /**
     * 주어진 열쇠(외부 클래스)와 묶음이 있다고 치고 고정점을 다시 계산한다(들여오기를 막는 클래스 순위에 쓴다).
     *
     * @param reasons null이 아니면 빠진 묶음의 이유를 넣는다
     */
    Set<String> fixpoint(Set<String> providedKeys, Set<String> providedNests, Map<String, String> reasons) {
        Set<String> alive = new TreeSet<>();
        Deque<String> removed = new ArrayDeque<>();
        for (String n : candidates.keySet()) {
            if (providedNests.contains(n)) continue;
            String failure = null;
            for (Map.Entry<String, String> f : hardFailures.get(n).entrySet()) {
                if (!providedKeys.contains(f.getKey())) {
                    failure = f.getValue();
                    break;
                }
            }
            if (failure == null) {
                alive.add(n);
            } else {
                removed.add(n);
                if (reasons != null) reasons.put(n, failure);
            }
        }
        Map<String, List<String>> reverse = reverseDeps();
        while (!removed.isEmpty()) {
            String gone = removed.poll();
            for (String user : reverse.getOrDefault(gone, Collections.<String>emptyList())) {
                if (alive.remove(user)) {
                    removed.add(user);
                    if (reasons != null) reasons.put(user, "uses " + dotted(gone) + " (not lifted)");
                }
            }
        }
        return alive;
    }

    private Map<String, List<String>> reverseCache;

    private Map<String, List<String>> reverseDeps() {
        if (reverseCache == null) {
            reverseCache = new HashMap<>();
            for (Map.Entry<String, Set<String>> e : nestDeps.entrySet())
                for (String d : e.getValue()) reverseCache.computeIfAbsent(d, k -> new ArrayList<>()).add(e.getKey());
        }
        return reverseCache;
    }

    /** 이 묶음 때문에(직접·간접) 들여오지 못한 묶음 수(묶음 자신 제외) */
    int dependentsBlocked(String nest) {
        Set<String> seen = new HashSet<>();
        Deque<String> queue = new ArrayDeque<>();
        queue.add(nest);
        while (!queue.isEmpty()) {
            for (String user : reverseDeps().getOrDefault(queue.poll(), Collections.<String>emptyList())) {
                if (!lifted.contains(user) && seen.add(user)) queue.add(user);
            }
        }
        seen.remove(nest);
        return seen.size();
    }

    // ---- 분석

    private enum Where {
        HAND,
        REAL,
        JDK
    }

    private static final class Found {
        final ClassFile file;
        final Where where;

        Found(ClassFile file, Where where) {
            this.file = file;
            this.where = where;
        }
    }

    /** 들여온 뒤의 세계에서 이 이름의 클래스(손 구현 > 후보 > JDK). 손 구현 묶음의 실제 클래스는 없는 것이다. */
    private Found lookup(String name) {
        ClassFile file = hand.get(name);
        if (file != null) return new Found(file, Where.HAND);
        file = real.get(name);
        if (file != null) return handNests.contains(nest(real, name)) ? null : new Found(file, Where.REAL);
        file = jdk.get(name);
        if (file != null) return new Found(file, Where.JDK);
        return null;
    }

    private void analyze(ClassFile file, String ownNest, Map<String, String> failures, Set<String> deps) {
        String self = dotted(file.name);
        for (String dep : file.dependencies) {
            Found found = lookup(dep);
            if (found == null) {
                String handNest = real.has(dep) ? nest(real, dep) : null;
                if (handNest != null && handNests.contains(handNest)) {
                    failures.putIfAbsent(dep, self + " uses " + dotted(dep)
                            + ", which the hand implementation of " + dotted(handNest) + " does not define");
                } else {
                    failures.putIfAbsent(dep, self + " uses " + dotted(dep) + " (not available)");
                }
                continue;
            }
            if (found.where == Where.REAL) {
                String n = nest(real, dep);
                if (!n.equals(ownNest)) deps.add(n);
            }
            if (!accessible(found.file.access, found.file.name, file.name))
                failures.putIfAbsent(dep, self + " cannot access " + dotted(dep) + " (not public)");
        }
        // 상위 형식의 종류
        if (file.superName != null) {
            Found sup = lookup(file.superName);
            if (sup != null) {
                if (sup.file.isInterface())
                    failures.putIfAbsent(file.superName, self + " extends interface " + dotted(file.superName));
                else if ((sup.file.access & ClassFile.ACC_FINAL) != 0)
                    failures.putIfAbsent(file.superName, self + " extends final " + dotted(file.superName));
            }
        }
        for (String type : file.interfaces) {
            Found sup = lookup(type);
            if (sup != null && !sup.file.isInterface())
                failures.putIfAbsent(type, self + " implements class " + dotted(type));
        }
        for (ClassFile.MemberRef ref : file.memberRefs) {
            String owner = ref.owner.startsWith("[") ? "java/lang/Object" : ref.owner;
            Found found = lookup(owner);
            if (found == null) continue; // 위에서 없는 클래스로 셌다
            String problem = checkMember(file, ref, owner, found);
            if (problem != null) {
                // 열쇠는 멤버를 찾은(찾지 못한) 소유 클래스
                failures.putIfAbsent(owner + "#" + ref.name + ref.descriptor, self + ": " + problem);
            }
        }
    }

    /** 멤버 참조 확인. 문제가 없으면 null. */
    private String checkMember(ClassFile from, ClassFile.MemberRef ref, String owner, Found ownerClass) {
        if (ref.kind == ClassFile.RefKind.METHOD && ownerClass.file.isInterface() && !ref.owner.startsWith("["))
            return "Methodref to interface " + ref;
        if (ref.kind == ClassFile.RefKind.INTERFACE_METHOD && !ownerClass.file.isInterface())
            return "InterfaceMethodref to class " + ref;
        Resolved resolved;
        if (ref.kind == ClassFile.RefKind.FIELD) {
            resolved = resolveField(owner, ref.name, ref.descriptor, new HashSet<String>());
        } else {
            resolved = resolveMethod(owner, ref.name, ref.descriptor, new HashSet<String>());
            if (resolved == null && ref.kind == ClassFile.RefKind.INTERFACE_METHOD)
                resolved = resolveMethod("java/lang/Object", ref.name, ref.descriptor, new HashSet<String>());
            if (resolved == null && isSignaturePolymorphic(owner, ref.name)) return null;
        }
        if (resolved == null) return "no " + (ref.kind == ClassFile.RefKind.FIELD ? "field " : "method ") + ref;
        if (resolved.member.isStatic() != ref.isStatic)
            return ref + " is " + (resolved.member.isStatic() ? "" : "not ") + "static";
        int access = resolved.member.access;
        String declaring = resolved.owner.name;
        if ((access & ClassFile.ACC_PRIVATE) != 0) {
            if (!declaring.equals(from.name)) return ref + " is private in " + dotted(declaring);
        } else if ((access & ClassFile.ACC_PUBLIC) == 0) {
            boolean samePackage = ClassFile.packageOf(declaring).equals(ClassFile.packageOf(from.name));
            if (!samePackage) {
                if ((access & ClassFile.ACC_PROTECTED) == 0 || !isSubclass(from.name, declaring))
                    return ref + " is not accessible (declared in " + dotted(declaring) + ")";
            }
        }
        return null;
    }

    private static boolean isSignaturePolymorphic(String owner, String name) {
        return (owner.equals("java/lang/invoke/MethodHandle") || owner.equals("java/lang/invoke/VarHandle"))
                && !name.equals("<init>");
    }

    private boolean isSubclass(String type, String ancestor) {
        String current = type;
        Set<String> seen = new HashSet<>();
        while (current != null && seen.add(current)) {
            if (current.equals(ancestor)) return true;
            Found f = lookup(current);
            if (f == null) return false;
            current = f.file.superName;
        }
        return false;
    }

    private static final class Resolved {
        final ClassFile owner;
        final ClassFile.Member member;

        Resolved(ClassFile owner, ClassFile.Member member) {
            this.owner = owner;
            this.member = member;
        }
    }

    /** JVMS 5.4.3.2: 자신 → 상위 인터페이스 → 상위 클래스 */
    private Resolved resolveField(String type, String name, String descriptor, Set<String> seen) {
        if (type == null || !seen.add(type)) return null;
        Found f = lookup(type);
        if (f == null) return null;
        ClassFile.Member m = f.file.findField(name, descriptor);
        if (m != null) return new Resolved(f.file, m);
        for (String i : f.file.interfaces) {
            Resolved r = resolveField(i, name, descriptor, seen);
            if (r != null) return r;
        }
        return resolveField(f.file.superName, name, descriptor, seen);
    }

    /** JVMS 5.4.3.3·5.4.3.4: 자신 → 상위 클래스 → 상위 인터페이스 */
    private Resolved resolveMethod(String type, String name, String descriptor, Set<String> seen) {
        if (type == null || !seen.add(type)) return null;
        Found f = lookup(type);
        if (f == null) return null;
        ClassFile.Member m = f.file.findMethod(name, descriptor);
        if (m != null) return new Resolved(f.file, m);
        Resolved r = resolveMethod(f.file.superName, name, descriptor, seen);
        if (r != null) return r;
        for (String i : f.file.interfaces) {
            r = resolveMethod(i, name, descriptor, seen);
            if (r != null) return r;
        }
        return null;
    }

    private static boolean accessible(int access, String target, String from) {
        return (access & ClassFile.ACC_PUBLIC) != 0 || ClassFile.packageOf(target).equals(ClassFile.packageOf(from));
    }

    static String dotted(String internalName) {
        return internalName.replace('/', '.');
    }

    /**
     * 들여오기를 가장 많이 막은 것들. 열쇠마다 "그것이 있다면(손 구현) 더 들여올 수 있는 묶음 수"로 순위를 매긴다.
     * 열쇠는 들여오지 못한 SDK 묶음(손 구현 후보)과, 닫히지 않는 외부 클래스·멤버다.
     */
    List<Blocker> topBlockers(int limit) {
        Map<String, Integer> score = new LinkedHashMap<>();
        // 외부 열쇠: 직접 막힌 묶음 수
        Map<String, Set<String>> byKey = new TreeMap<>();
        for (Map.Entry<String, Map<String, String>> e : hardFailures.entrySet())
            for (String key : e.getValue().keySet()) byKey.computeIfAbsent(key, k -> new TreeSet<>()).add(e.getKey());
        List<Blocker> candidatesList = new ArrayList<>();
        for (Map.Entry<String, Set<String>> e : byKey.entrySet())
            candidatesList.add(new Blocker(e.getKey(), false, e.getValue().size(), 0));
        for (String n : candidates.keySet()) {
            if (lifted.contains(n)) continue;
            int d = dependentsBlocked(n);
            if (d > 0) candidatesList.add(new Blocker(n, true, d, 0));
        }
        // 대략적 순위로 먼저 줄이고, 상위 몇 개만 반사실(있다면) 계산
        candidatesList.sort((a, b) -> b.direct - a.direct);
        List<Blocker> result = new ArrayList<>();
        int base = lifted.size();
        for (Blocker b : candidatesList.subList(0, Math.min(candidatesList.size(), limit * 4))) {
            Set<String> after = b.isNest
                    ? fixpoint(Collections.<String>emptySet(), Collections.singleton(b.key), null)
                    : fixpoint(Collections.singleton(b.key), Collections.<String>emptySet(), null);
            result.add(new Blocker(b.key, b.isNest, b.direct, after.size() - base));
        }
        result.sort((a, b) -> a.unlock != b.unlock ? b.unlock - a.unlock : b.direct - a.direct);
        for (Blocker b : result) score.put(b.key, b.unlock);
        return result.subList(0, Math.min(limit, result.size()));
    }

    static final class Blocker {
        final String key;
        final boolean isNest;
        /** 묶음이면 막힌 하위(간접 포함) 묶음 수, 외부 열쇠면 직접 막힌 묶음 수 */
        final int direct;
        /** 이것이 손 구현으로 있으면 더 들여올 수 있는 묶음 수 */
        final int unlock;

        Blocker(String key, boolean isNest, int direct, int unlock) {
            this.key = key;
            this.isNest = isNest;
            this.direct = direct;
            this.unlock = unlock;
        }
    }

    /** 들여온 클래스들의 이름 */
    List<String> liftedClasses() {
        List<String> names = new ArrayList<>();
        for (String n : lifted) names.addAll(candidates.get(n));
        Collections.sort(names);
        return names;
    }

    Set<String> handNests() {
        return Collections.unmodifiableSet(handNests);
    }

    /**
     * 링크만 확인한다(패치한 들여온 클래스가 손 구현·sim·JDK와 닫히는지). 문제 목록을 돌려준다.
     *
     * @param universe 손 구현·sim·stub·들여온 클래스 전부(최종 sdk 클래스)
     */
    static List<String> linkCheck(Collection<String> names, ClassSource classes, ClassSource universe, ClassSource jdk) {
        Lifter checker = new Lifter(ClassSource.chain(java.util.Arrays.asList(universe)), emptySource(), jdk);
        List<String> problems = new ArrayList<>();
        for (String name : names) {
            Map<String, String> failures = new LinkedHashMap<>();
            checker.analyze(classes.get(name), name, failures, new LinkedHashSet<String>());
            problems.addAll(failures.values());
        }
        return problems;
    }

    private static ClassSource emptySource() {
        return new ClassSource() {
            @Override
            List<String> names() {
                return Collections.emptyList();
            }

            @Override
            byte[] bytes(String internalName) {
                return null;
            }
        };
    }
}
