package org.sandbot.runtime;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 라이브러리 jar의 링크 검사(RunRequest.libraryClasspath가 있을 때 컴파일 전에 한 번, 프로토콜 linkReport). 각 jar 클래스의 상수 풀에서
 * 클래스·필드·메서드 참조를 모아, 실행 때 보이는 세계(앱 로더: JDK·sandbot-sdk.jar·런타임, 그다음 라이브러리 jar들 — 실제 로더와 같은
 * 부모 우선 순서)에 대어 본다. 클래스는 정의하지 않고 바이트로만 읽는다.
 *
 * <ul>
 *   <li>missingClass: 참조한 클래스가 없다(멤버 참조의 소유 클래스가 없을 때도). 배열은 원소 형식을 본다.
 *   <li>missingMember: 클래스는 있지만 그 필드·메서드가 없다. 찾는 순서는 JVMS 5.4.3(필드: 클래스 → 상위 인터페이스 → 상위 클래스,
 *       메서드: 클래스와 상위 클래스 → 상위 인터페이스, 인터페이스 메서드: 인터페이스 → Object → 상위 인터페이스, 생성자는 그
 *       클래스만, MethodHandle·VarHandle의 서명 다형 메서드는 서술자와 관계없이). 상위 형식이 없어 끝까지 찾을 수 없으면 알리지 않는다.
 *   <li>unsupported: 앱 로더(가짜 SDK)의 그 메서드가 SimUnsupportedException을 바로 던지는 껍데기(stub 본문, 손 구현의
 *       {@code throw new SimUnsupportedException(…)}·{@code throw unsupported(…)})이거나, 필드가 껍데기 클래스(모든 메서드가 그런
 *       클래스)의 것이다. 조건부로 던지는 곳은 알 수 없다.
 * </ul>
 * 결과는 결정적 순서다: jar 요청 순서 → 클래스 이름순 → 상수 풀 순서. 같은 jar의 같은 (종류, 대상)은 한 번(처음 참조한 클래스가 from),
 * 모두 {@link #MAX_WARNINGS}개까지. 앞의 jar나 앱 로더가 같은 이름을 가려 실행 때 쓰이지 않는 클래스는 보지 않는다.
 * 대상 글자: 클래스는 바이너리 이름(a.b.C$D), 메서드는 {@code a.b.C#name(서술자)}, 필드는 {@code a.b.C#name:서술자}.
 */
final class LinkCheck {
    static final int MAX_WARNINGS = 500;
    static final String UNSUPPORTED = "org/sandbot/sim/SimUnsupportedException";

    static final class Warning {
        final String jar;
        final String kind;
        final String from;
        final String target;

        Warning(String jar, String kind, String from, String target) {
            this.jar = jar;
            this.kind = kind;
            this.from = from;
            this.target = target;
        }

        Map<String, Object> toJson() {
            return Json.obj("jar", jar, "kind", kind, "from", from, "target", target);
        }

        @Override
        public String toString() {
            return kind + " " + target + " (from " + from + " in " + jar + ")";
        }
    }

    private final LibraryJars libraries;
    private final ClassLoader app;
    /** 실행 때 보이는 클래스(내부 이름 → 모델). 없으면 MISSING. */
    private final Map<String, Model> universe = new HashMap<>();
    private static final Model MISSING = new Model();

    LinkCheck(LibraryJars libraries, ClassLoader app) {
        this.libraries = libraries;
        this.app = app;
    }

    List<Warning> run() {
        List<Warning> out = new ArrayList<>();
        for (LibraryJars.Jar jar : libraries.jars) {
            Set<String> seen = new HashSet<>();
            for (String name : jar.classNames()) {
                if (out.size() >= MAX_WARNINGS) return out;
                Model self = lookup(name);
                // 가려진 클래스(앱 로더나 앞의 jar가 같은 이름을 가짐)는 실행 때 정의되지 않는다
                if (self == MISSING || self.jar != jar) continue;
                checkClass(jar, self, seen, out);
            }
        }
        return out;
    }

    private void checkClass(LibraryJars.Jar jar, Model self, Set<String> seen, List<Warning> out) {
        String from = binary(self.name);
        for (Ref ref : self.refs) {
            if (out.size() >= MAX_WARNINGS) return;
            if (ref.kind == Ref.CLASS) {
                String element = elementClass(ref.owner);
                if (element != null && lookup(element) == MISSING) add(jar, "missingClass", from, binary(element), seen, out);
                continue;
            }
            String owner = elementClass(ref.owner);
            if (owner == null || ref.owner.startsWith("[")) continue; // 배열의 clone 등(Object)
            Model c = lookup(owner);
            if (c == MISSING) {
                add(jar, "missingClass", from, binary(owner), seen, out);
                continue;
            }
            boolean field = ref.kind == Ref.FIELD;
            String target = binary(owner) + "#" + ref.name + (field ? ":" : "") + ref.desc;
            Found found = field ? findField(c, ref.name + ":" + ref.desc, new HashSet<>())
                    : findMethod(c, ref.name, ref.desc, ref.kind == Ref.INTERFACE_METHOD);
            if (found == null) continue; // 상위 형식이 없어 알 수 없음
            if (found.declaring == null) {
                add(jar, "missingMember", from, target, seen, out);
            } else if (found.declaring.jar == null && found.declaring != MISSING) {
                boolean unsupported = field ? found.declaring.isStub()
                        : found.declaring.unsupported.contains(ref.name + ref.desc);
                if (unsupported) add(jar, "unsupported", from, target, seen, out);
            }
        }
    }

    private static void add(LibraryJars.Jar jar, String kind, String from, String target, Set<String> seen,
            List<Warning> out) {
        if (seen.add(kind + " " + target)) out.add(new Warning(jar.path, kind, from, target));
    }

    // ---- 찾기(JVMS 5.4.3) ----

    /** declaring이 null이면 없음. 메서드 자체가 null이면 알 수 없음(상위 형식이 없다). */
    private static final class Found {
        final Model declaring;

        Found(Model declaring) {
            this.declaring = declaring;
        }
    }

    private static final Found NOT_FOUND = new Found(null);

    private Found findField(Model c, String key, Set<String> visited) {
        if (!visited.add(c.name)) return NOT_FOUND;
        if (c.fields.contains(key)) return new Found(c);
        for (String i : c.interfaces) {
            Model m = lookup(i);
            if (m == MISSING) return null;
            Found f = findField(m, key, visited);
            if (f == null || f.declaring != null) return f;
        }
        if (c.superName == null) return NOT_FOUND;
        Model s = lookup(c.superName);
        if (s == MISSING) return null;
        return findField(s, key, visited);
    }

    private Found findMethod(Model c, String name, String desc, boolean interfaceRef) {
        String key = name + desc;
        if (name.equals("<init>") || name.equals("<clinit>")) return c.methods.contains(key) ? new Found(c) : NOT_FOUND;
        if (!interfaceRef) {
            // 클래스와 상위 클래스(서명 다형 메서드 포함)
            for (Model m = c; m != null; ) {
                if (m.methods.contains(key) || m.signaturePolymorphic.contains(name)) return new Found(m);
                if (m.superName == null) break;
                Model s = lookup(m.superName);
                if (s == MISSING) return null;
                m = s;
            }
        } else {
            if (c.methods.contains(key)) return new Found(c);
            Model object = lookup("java/lang/Object");
            if (object != MISSING && object.methods.contains(key)) return new Found(object);
        }
        // 상위 인터페이스(클래스면 상위 클래스들의 인터페이스도)
        Set<String> visited = new HashSet<>();
        List<Model> classes = new ArrayList<>();
        for (Model m = c; m != null; ) {
            classes.add(m);
            if (m.superName == null || interfaceRef) break;
            Model s = lookup(m.superName);
            if (s == MISSING) return null;
            m = s;
        }
        boolean unknown = false;
        for (Model m : classes) {
            for (String i : m.interfaces) {
                Found f = findInInterfaces(i, key, visited);
                if (f == null) unknown = true;
                else if (f.declaring != null) return f;
            }
        }
        return unknown ? null : NOT_FOUND;
    }

    private Found findInInterfaces(String name, String key, Set<String> visited) {
        if (!visited.add(name)) return NOT_FOUND;
        Model m = lookup(name);
        if (m == MISSING) return null;
        if (m.methods.contains(key)) return new Found(m);
        boolean unknown = false;
        for (String i : m.interfaces) {
            Found f = findInInterfaces(i, key, visited);
            if (f == null) unknown = true;
            else if (f.declaring != null) return f;
        }
        return unknown ? null : NOT_FOUND;
    }

    // ---- 클래스 모델 ----

    /** 실행 때 이 이름으로 보일 클래스: 앱 로더(JDK·가짜 SDK) 먼저, 다음 라이브러리 jar 순서 */
    private Model lookup(String internalName) {
        Model cached = universe.get(internalName);
        if (cached != null) return cached;
        Model model = MISSING;
        byte[] bytes = appBytes(internalName);
        LibraryJars.Jar from = null;
        if (bytes == null) {
            for (LibraryJars.Jar jar : libraries.jars) {
                try {
                    bytes = jar.classBytes(internalName);
                } catch (IOException e) {
                    bytes = null;
                }
                if (bytes != null) {
                    from = jar;
                    break;
                }
            }
        }
        if (bytes != null) {
            try {
                model = Model.parse(bytes, from);
                if (!model.name.equals(internalName)) model = MISSING; // 이름이 다른 클래스 파일
            } catch (RuntimeException e) {
                model = MISSING;
            }
        }
        universe.put(internalName, model);
        return model;
    }

    private byte[] appBytes(String internalName) {
        try (InputStream in = app.getResourceAsStream(internalName + ".class")) {
            return in == null ? null : in.readAllBytes();
        } catch (IOException e) {
            return null;
        }
    }

    /** "[[Lx/Y;" → "x/Y", "[I" → null, "x/Y" → "x/Y" */
    private static String elementClass(String name) {
        if (!name.startsWith("[")) return name;
        int i = 0;
        while (i < name.length() && name.charAt(i) == '[') i++;
        if (i < name.length() && name.charAt(i) == 'L' && name.endsWith(";")) return name.substring(i + 1, name.length() - 1);
        return null;
    }

    private static String binary(String internalName) {
        return internalName.replace('/', '.');
    }

    private static final class Ref {
        static final int CLASS = 0;
        static final int FIELD = 1;
        static final int METHOD = 2;
        static final int INTERFACE_METHOD = 3;
        final int kind;
        final String owner;
        final String name;
        final String desc;

        Ref(int kind, String owner, String name, String desc) {
            this.kind = kind;
            this.owner = owner;
            this.name = name;
            this.desc = desc;
        }
    }

    /** 링크 검사에 필요한 만큼 읽은 클래스 파일 */
    private static final class Model {
        String name;
        String superName;
        String[] interfaces = new String[0];
        /** 라이브러리 jar(앱 로더 클래스면 null) */
        LibraryJars.Jar jar;
        final Set<String> fields = new HashSet<>();
        final Set<String> methods = new HashSet<>();
        /** SimUnsupportedException을 바로 던지는 메서드(이름 + 서술자) */
        final Set<String> unsupported = new HashSet<>();
        /** 서명 다형 메서드 이름(MethodHandle.invoke 등) */
        final Set<String> signaturePolymorphic = new HashSet<>();
        final List<Ref> refs = new ArrayList<>();
        int codeMethods;
        boolean hasConstructor;

        /** 껍데기 클래스: 생성자가 있고, 본문이 있는 메서드(정적 초기화 제외)가 모두 바로 던진다 */
        boolean isStub() {
            return jar == null && hasConstructor && codeMethods > 0 && unsupported.size() == codeMethods;
        }

        static Model parse(byte[] b, LibraryJars.Jar jar) {
            Reader r = new Reader(b);
            if (r.u4(0) != 0xCAFEBABE) throw new IllegalArgumentException("not a class file");
            Model m = new Model();
            m.jar = jar;
            int count = r.u2(8);
            int[] offsets = new int[count];
            int p = 10;
            for (int i = 1; i < count; i++) {
                offsets[i] = p;
                int tag = r.u1(p);
                switch (tag) {
                    case 1:
                        p += 3 + r.u2(p + 1);
                        break;
                    case 3:
                    case 4:
                    case 9:
                    case 10:
                    case 11:
                    case 12:
                    case 17:
                    case 18:
                        p += 5;
                        break;
                    case 5:
                    case 6:
                        p += 9;
                        i++;
                        break;
                    case 7:
                    case 8:
                    case 16:
                    case 19:
                    case 20:
                        p += 3;
                        break;
                    case 15:
                        p += 4;
                        break;
                    default:
                        throw new IllegalArgumentException("bad constant pool tag " + tag);
                }
            }
            Pool cp = new Pool(r, offsets);
            m.name = cp.className(r.u2(p + 2));
            int access = r.u2(p);
            int superIndex = r.u2(p + 4);
            m.superName = superIndex == 0 ? null : cp.className(superIndex);
            int interfaceCount = r.u2(p + 6);
            m.interfaces = new String[interfaceCount];
            p += 8;
            for (int i = 0; i < interfaceCount; i++, p += 2) m.interfaces[i] = cp.className(r.u2(p));
            boolean methodHandleOwner = m.name.equals("java/lang/invoke/MethodHandle")
                    || m.name.equals("java/lang/invoke/VarHandle");
            for (int pass = 0; pass < 2; pass++) {
                int members = r.u2(p);
                p += 2;
                for (int i = 0; i < members; i++) {
                    int flags = r.u2(p);
                    String memberName = cp.utf8(r.u2(p + 2));
                    String desc = cp.utf8(r.u2(p + 4));
                    int attributes = r.u2(p + 6);
                    p += 8;
                    if (pass == 0) m.fields.add(memberName + ":" + desc);
                    else {
                        m.methods.add(memberName + desc);
                        if (memberName.equals("<init>")) m.hasConstructor = true;
                        // 서명 다형(JVMS 2.9.3): MethodHandle·VarHandle의 native varargs (Object[])
                        if (methodHandleOwner && (flags & 0x0180) == 0x0180 && desc.startsWith("([Ljava/lang/Object;)"))
                            m.signaturePolymorphic.add(memberName);
                    }
                    for (int a = 0; a < attributes; a++) {
                        int length = r.u4(p + 2);
                        if (pass == 1 && jar == null && "Code".equals(cp.utf8(r.u2(p))) && !memberName.equals("<clinit>")) {
                            m.codeMethods++;
                            int start = p + 14;
                            if (throwsUnsupported(r, cp, start, start + r.u4(p + 10))) m.unsupported.add(memberName + desc);
                        }
                        p += 6 + length;
                    }
                }
            }
            if ((access & 0x0200) != 0) m.hasConstructor = false;
            // 참조(상수 풀 순서). 라이브러리 클래스만 필요하다.
            if (jar != null) {
                for (int i = 1; i < count; i++) {
                    if (offsets[i] == 0) continue;
                    int tag = r.u1(offsets[i]);
                    if (tag == 7) {
                        String c = cp.className(i);
                        if (!c.equals(m.name)) m.refs.add(new Ref(Ref.CLASS, c, null, null));
                    } else if (tag == 9 || tag == 10 || tag == 11) {
                        String owner = cp.className(r.u2(offsets[i] + 1));
                        int nat = offsets[r.u2(offsets[i] + 3)];
                        int kind = tag == 9 ? Ref.FIELD : tag == 10 ? Ref.METHOD : Ref.INTERFACE_METHOD;
                        m.refs.add(new Ref(kind, owner, cp.utf8(r.u2(nat + 1)), cp.utf8(r.u2(nat + 3))));
                    }
                }
            }
            return m;
        }

        /**
         * 본문이 SimUnsupportedException을 바로 던지는가: 앞에는 값 싣기·dup·checkcast와 (생성자의) super 호출 하나만 있고, 그다음이
         * {@code new SimUnsupportedException}이거나 SimUnsupportedException을 돌려주는 호출 + athrow다.
         */
        private static boolean throwsUnsupported(Reader r, Pool cp, int start, int end) {
            int pc = start;
            boolean superCall = false;
            for (int steps = 0; steps < 24 && pc < end; steps++) {
                int op = r.u1(pc);
                if (op == 0xBB) return cp.className(r.u2(pc + 1)).equals(UNSUPPORTED);
                if (op >= 0xB6 && op <= 0xB9) {
                    int ref = cp.offsets[r.u2(pc + 1)];
                    int nat = cp.offsets[r.u2(ref + 3)];
                    String name = cp.utf8(r.u2(nat + 1));
                    String desc = cp.utf8(r.u2(nat + 3));
                    int length = op == 0xB9 ? 5 : 3;
                    if (desc.endsWith(")L" + UNSUPPORTED + ";")) return pc + length < end && r.u1(pc + length) == 0xBF;
                    if (op == 0xB7 && name.equals("<init>") && !superCall) {
                        superCall = true;
                        pc += 3;
                        continue;
                    }
                    return false;
                }
                int length;
                if (op >= 0x01 && op <= 0x0F) length = 1; // 상수
                else if (op == 0x10 || op == 0x12) length = 2; // bipush, ldc
                else if (op == 0x11 || op == 0x13 || op == 0x14) length = 3; // sipush, ldc_w, ldc2_w
                else if (op >= 0x15 && op <= 0x19) length = 2; // xload
                else if (op >= 0x1A && op <= 0x2D) length = 1; // xload_n
                else if (op == 0x59) length = 1; // dup
                else if (op == 0xC0) length = 3; // checkcast
                else return false;
                pc += length;
            }
            return false;
        }
    }

    private static final class Pool {
        final Reader r;
        final int[] offsets;
        private final Map<Integer, String> utf8 = new LinkedHashMap<>();

        Pool(Reader r, int[] offsets) {
            this.r = r;
            this.offsets = offsets;
        }

        String utf8(int index) {
            String cached = utf8.get(index);
            if (cached != null) return cached;
            int p = offsets[index];
            if (r.u1(p) != 1) throw new IllegalArgumentException("not Utf8: " + index);
            String s = r.modifiedUtf8(p + 3, r.u2(p + 1));
            utf8.put(index, s);
            return s;
        }

        String className(int index) {
            int p = offsets[index];
            if (r.u1(p) != 7) throw new IllegalArgumentException("not a Class: " + index);
            return utf8(r.u2(p + 1));
        }
    }

    private static final class Reader {
        final byte[] b;

        Reader(byte[] b) {
            this.b = b;
        }

        int u1(int p) {
            return b[p] & 0xFF;
        }

        int u2(int p) {
            return ((b[p] & 0xFF) << 8) | (b[p + 1] & 0xFF);
        }

        int u4(int p) {
            return ((b[p] & 0xFF) << 24) | ((b[p + 1] & 0xFF) << 16) | ((b[p + 2] & 0xFF) << 8) | (b[p + 3] & 0xFF);
        }

        String modifiedUtf8(int start, int length) {
            StringBuilder out = new StringBuilder(length);
            int p = start;
            int end = start + length;
            while (p < end) {
                int c = b[p] & 0xFF;
                if (c < 0x80) {
                    out.append((char) c);
                    p++;
                } else if ((c & 0xE0) == 0xC0) {
                    out.append((char) (((c & 0x1F) << 6) | (b[p + 1] & 0x3F)));
                    p += 2;
                } else {
                    out.append((char) (((c & 0x0F) << 12) | ((b[p + 1] & 0x3F) << 6) | (b[p + 2] & 0x3F)));
                    p += 3;
                }
            }
            return out.toString();
        }
    }
}
