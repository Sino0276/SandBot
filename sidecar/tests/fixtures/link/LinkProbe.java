import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import java.lang.invoke.VarHandle;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 링크 확인(build.test.ts): 인수 파일에 적힌 클래스(들여온 실제 SDK 클래스·손 구현)마다 JVM에서 실제로
 * <ul>
 *   <li>불러오고 정적 초기화를 돌린다(NoClassDefFoundError·ExceptionInInitializerError가 없어야 한다).
 *   <li>선언한 멤버의 서술자 형식을 모두 푼다(getDeclaredMethods 등).
 *   <li>상수 풀의 필드·메서드 참조를 모두 푼다(JVM은 처음 실행할 때 풀므로, 실행하지 않은 길의 NoSuchMethodError·
 *       NoSuchFieldError를 여기서 미리 찾는다). 빌드의 링크 확인(Lifter)과 다른 방법(MethodHandles·리플렉션)으로 한다.
 * </ul>
 * 줄마다 "FAIL …"이고, 끝 줄은 "LINKED classes=… refs=…". 런타임처럼 먼저 모의 저장소를 넣는다(AppUtil의 폴더 상수가 정적
 * 초기화에서 읽는다).
 */
public final class LinkProbe {
    public static void main(String[] args) throws Exception {
        List<String> names = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);
        ClassLoader loader = LinkProbe.class.getClassLoader();
        File first = Files.createTempDirectory(Paths.get(args[0]).toAbsolutePath().getParent(), "FIRST").toFile();
        Class.forName("org.sandbot.sim.Sim", true, loader).getMethod("installFirstFolder", File.class)
                .invoke(null, first);
        int classes = 0;
        int refs = 0;
        int failures = 0;
        for (String name : names) {
            if (name.isEmpty()) continue;
            Class<?> type;
            try {
                type = Class.forName(name, true, loader);
                type.getDeclaredMethods();
                type.getDeclaredFields();
                type.getDeclaredConstructors();
            } catch (Throwable t) {
                System.out.println("FAIL " + name + ": " + t);
                failures++;
                continue;
            }
            MethodHandles.Lookup lookup = MethodHandles.privateLookupIn(type, MethodHandles.lookup());
            byte[] bytes;
            try (InputStream in = loader.getResourceAsStream(name.replace('.', '/') + ".class")) {
                bytes = in.readAllBytes();
            }
            for (String[] ref : memberRefs(bytes)) {
                refs++;
                String problem = resolve(lookup, loader, ref);
                if (problem != null) {
                    System.out.println("FAIL " + name + " -> " + ref[1] + "." + ref[2] + ref[3] + ": " + problem);
                    failures++;
                }
            }
            classes++;
        }
        System.out.println("LINKED classes=" + classes + " refs=" + refs);
        System.exit(failures == 0 ? 0 : 1);
    }

    /** 참조 하나를 푼다. 문제가 없으면 null. 접근 검사(Lifter가 한다)는 하지 않고 멤버가 있는지만 본다. */
    private static String resolve(MethodHandles.Lookup lookup, ClassLoader loader, String[] ref) {
        try {
            Class<?> owner = Class.forName(ref[1].replace('/', '.'), false, loader);
            String name = ref[2];
            if (ref[0].equals("F")) {
                Class<?> fieldType = MethodType.fromMethodDescriptorString("()" + ref[3], loader).returnType();
                // 정적·인스턴스 둘 다 해 본다. 접근할 수 없다는 것(보호된 상위 멤버, 정적 여부가 다름)은 필드가 있다는 뜻이다
                // (정적 여부·접근은 빌드의 링크 확인이 본다)
                boolean exists = false;
                for (int kind = 0; kind < 2; kind++) {
                    try {
                        if (kind == 0) lookup.findStaticGetter(owner, name, fieldType);
                        else lookup.findGetter(owner, name, fieldType);
                        return null;
                    } catch (IllegalAccessException e) {
                        exists = true;
                    } catch (NoSuchFieldException e) {
                        // 다른 종류로 다시
                    }
                }
                return exists ? null : "no such field";
            }
            MethodType methodType = MethodType.fromMethodDescriptorString(ref[3], loader);
            if (owner.isArray() || owner == MethodHandle.class || owner == VarHandle.class) return null;
            if (name.equals("<init>")) {
                owner.getDeclaredConstructor(methodType.parameterArray());
                return null;
            }
            if (hasMethod(owner, name, methodType)) return null;
            return "no such method";
        } catch (Throwable t) {
            return t.toString();
        }
    }

    /** JVMS 5.4.3.3의 찾는 순서(자신 → 상위 클래스 → 상위 인터페이스)로 이름·서술자가 같은 메서드가 있는가 */
    private static boolean hasMethod(Class<?> type, String name, MethodType methodType) {
        if (type == null) return false;
        for (Method m : type.getDeclaredMethods()) {
            if (m.getName().equals(name) && m.getReturnType() == methodType.returnType()
                    && Arrays.equals(m.getParameterTypes(), methodType.parameterArray())) return true;
        }
        if (hasMethod(type.getSuperclass(), name, methodType)) return true;
        for (Class<?> i : type.getInterfaces()) if (hasMethod(i, name, methodType)) return true;
        return type.isInterface() && hasMethod(Object.class, name, methodType);
    }

    /** 상수 풀의 Fieldref·Methodref·InterfaceMethodref: {"F"|"M", 소유 클래스, 이름, 서술자} */
    private static List<String[]> memberRefs(byte[] bytes) throws IOException {
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(bytes));
        in.readInt();
        in.readUnsignedShort();
        in.readUnsignedShort();
        int count = in.readUnsignedShort();
        String[] utf8 = new String[count];
        int[] tags = new int[count];
        int[][] links = new int[count][];
        for (int i = 1; i < count; i++) {
            int tag = in.readUnsignedByte();
            tags[i] = tag;
            switch (tag) {
                case 1:
                    utf8[i] = in.readUTF();
                    break;
                case 3:
                case 4:
                    in.readInt();
                    break;
                case 5:
                case 6:
                    in.readLong();
                    i++;
                    break;
                case 7:
                case 8:
                case 16:
                case 19:
                case 20:
                    links[i] = new int[] {in.readUnsignedShort()};
                    break;
                case 9:
                case 10:
                case 11:
                case 12:
                case 17:
                case 18:
                    links[i] = new int[] {in.readUnsignedShort(), in.readUnsignedShort()};
                    break;
                case 15:
                    in.readUnsignedByte();
                    in.readUnsignedShort();
                    break;
                default:
                    throw new IOException("unknown constant pool tag " + tag);
            }
        }
        List<String[]> refs = new ArrayList<>();
        for (int i = 1; i < count; i++) {
            if (tags[i] != 9 && tags[i] != 10 && tags[i] != 11) continue;
            String owner = utf8[links[links[i][0]][0]];
            int[] nameAndType = links[links[i][1]];
            refs.add(new String[] {tags[i] == 9 ? "F" : "M", owner, utf8[nameAndType[0]], utf8[nameAndType[1]]});
        }
        return refs;
    }
}
