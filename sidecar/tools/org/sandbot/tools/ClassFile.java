package org.sandbot.tools;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 클래스 파일 읽기(JVMS 4장). 들여오기(의존·링크 확인)와 API 대조가 쓴다. ASM 없이 필요한 것만 읽는다.
 *
 * <p>의존({@link #dependencies})은 클래스가 실제로 쓰는 형식이다: 상위 형식, 자기 필드·메서드 서술자와 Signature·throws,
 * 멤버 참조(소유 형식과 서술자), 코드의 클래스 상수(new·checkcast·instanceof·anewarray·multianewarray·ldc), 예외 표의 catch
 * 형식, StackMapTable의 형식(검증기가 불러올 수 있다), MethodType·MethodHandle·invokedynamic 서술자, 런타임에 보이는
 * 애너테이션. InnerClasses에만 나오는 클래스와 런타임에 보이지 않는 애너테이션은 넣지 않는다.
 */
final class ClassFile {
    static final int ACC_PUBLIC = 0x0001;
    static final int ACC_PRIVATE = 0x0002;
    static final int ACC_PROTECTED = 0x0004;
    static final int ACC_STATIC = 0x0008;
    static final int ACC_FINAL = 0x0010;
    static final int ACC_SYNCHRONIZED = 0x0020;
    static final int ACC_VOLATILE = 0x0040;
    static final int ACC_BRIDGE = 0x0040;
    static final int ACC_TRANSIENT = 0x0080;
    static final int ACC_VARARGS = 0x0080;
    static final int ACC_NATIVE = 0x0100;
    static final int ACC_INTERFACE = 0x0200;
    static final int ACC_ABSTRACT = 0x0400;
    static final int ACC_STRICT = 0x0800;
    static final int ACC_SYNTHETIC = 0x1000;
    static final int ACC_ANNOTATION = 0x2000;
    static final int ACC_ENUM = 0x4000;

    /** 멤버 참조의 종류(상수 풀 태그) */
    enum RefKind {
        FIELD,
        METHOD,
        INTERFACE_METHOD
    }

    /** 필드·메서드 하나 */
    static final class Member {
        final int access;
        final String name;
        final String descriptor;
        String signature;
        /** ConstantValue(Integer·Long·Float·Double·String) */
        Object constant;
        final List<String> exceptions = new ArrayList<>();
        /** 런타임에 보이는 애너테이션(정규화한 글자, 값 포함) */
        final List<String> annotations = new ArrayList<>();
        /** 애너테이션 형식 요소의 기본값(정규화한 글자) */
        String annotationDefault;

        Member(int access, String name, String descriptor) {
            this.access = access;
            this.name = name;
            this.descriptor = descriptor;
        }

        boolean isStatic() {
            return (access & ACC_STATIC) != 0;
        }

        @Override
        public String toString() {
            return name + descriptor;
        }
    }

    /** 코드가 쓰는 멤버 참조. isStatic은 명령으로 정한 기대값(getstatic·invokestatic·REF_invokeStatic …). */
    static final class MemberRef {
        final String owner;
        final String name;
        final String descriptor;
        final RefKind kind;
        final boolean isStatic;

        MemberRef(String owner, String name, String descriptor, RefKind kind, boolean isStatic) {
            this.owner = owner;
            this.name = name;
            this.descriptor = descriptor;
            this.kind = kind;
            this.isStatic = isStatic;
        }

        String key() {
            return kind + " " + (isStatic ? "static " : "") + owner + "." + name + descriptor;
        }

        @Override
        public String toString() {
            return owner.replace('/', '.') + "." + name + descriptor;
        }
    }

    /** InnerClasses 항목 하나 */
    static final class InnerClass {
        final String inner;
        final String outer;
        final String simpleName;
        final int access;

        InnerClass(String inner, String outer, String simpleName, int access) {
            this.inner = inner;
            this.outer = outer;
            this.simpleName = simpleName;
            this.access = access;
        }
    }

    final String name;
    final int access;
    final String superName;
    final List<String> interfaces = new ArrayList<>();
    String signature;
    String enclosingClass;
    final List<Member> fields = new ArrayList<>();
    final List<Member> methods = new ArrayList<>();
    final List<InnerClass> innerClasses = new ArrayList<>();
    final List<String> annotations = new ArrayList<>();
    final Set<String> dependencies = new LinkedHashSet<>();
    final List<MemberRef> memberRefs = new ArrayList<>();
    final int majorVersion;

    // 상수 풀
    private final int[] tags;
    private final Object[] values;
    private final int[] refA;
    private final int[] refB;
    private final List<int[]> bootstrapMethods = new ArrayList<>();
    private final Map<String, MemberRef> refs = new LinkedHashMap<>();

    private static final int UTF8 = 1, INTEGER = 3, FLOAT = 4, LONG = 5, DOUBLE = 6, CLASS = 7, STRING = 8,
            FIELDREF = 9, METHODREF = 10, IMETHODREF = 11, NAME_AND_TYPE = 12, METHOD_HANDLE = 15,
            METHOD_TYPE = 16, DYNAMIC = 17, INVOKE_DYNAMIC = 18, MODULE = 19, PACKAGE = 20;

    static ClassFile parse(byte[] bytes) throws IOException {
        return new ClassFile(new DataInputStream(new ByteArrayInputStream(bytes)));
    }

    private ClassFile(DataInputStream in) throws IOException {
        if (in.readInt() != 0xCAFEBABE) throw new IOException("not a class file");
        in.readUnsignedShort();
        majorVersion = in.readUnsignedShort();
        int count = in.readUnsignedShort();
        tags = new int[count];
        values = new Object[count];
        refA = new int[count];
        refB = new int[count];
        for (int i = 1; i < count; i++) {
            int tag = in.readUnsignedByte();
            tags[i] = tag;
            switch (tag) {
                case UTF8:
                    values[i] = in.readUTF();
                    break;
                case INTEGER:
                    values[i] = in.readInt();
                    break;
                case FLOAT:
                    values[i] = in.readFloat();
                    break;
                case LONG:
                    values[i] = in.readLong();
                    i++;
                    break;
                case DOUBLE:
                    values[i] = in.readDouble();
                    i++;
                    break;
                case CLASS:
                case STRING:
                case METHOD_TYPE:
                case MODULE:
                case PACKAGE:
                    refA[i] = in.readUnsignedShort();
                    break;
                case FIELDREF:
                case METHODREF:
                case IMETHODREF:
                case NAME_AND_TYPE:
                case DYNAMIC:
                case INVOKE_DYNAMIC:
                    refA[i] = in.readUnsignedShort();
                    refB[i] = in.readUnsignedShort();
                    break;
                case METHOD_HANDLE:
                    refA[i] = in.readUnsignedByte();
                    refB[i] = in.readUnsignedShort();
                    break;
                default:
                    throw new IOException("unknown constant pool tag " + tag);
            }
        }
        access = in.readUnsignedShort();
        name = className(in.readUnsignedShort());
        int superIndex = in.readUnsignedShort();
        superName = superIndex == 0 ? null : className(superIndex);
        if (superName != null) dependencies.add(superName);
        int interfaceCount = in.readUnsignedShort();
        for (int i = 0; i < interfaceCount; i++) {
            String type = className(in.readUnsignedShort());
            interfaces.add(type);
            dependencies.add(type);
        }
        int fieldCount = in.readUnsignedShort();
        for (int i = 0; i < fieldCount; i++) fields.add(readMember(in, false));
        int methodCount = in.readUnsignedShort();
        List<byte[]> codes = new ArrayList<>();
        for (int i = 0; i < methodCount; i++) methods.add(readMember(in, true, codes));
        int attributeCount = in.readUnsignedShort();
        for (int i = 0; i < attributeCount; i++) {
            String attribute = utf8(in.readUnsignedShort());
            int length = in.readInt();
            switch (attribute) {
                case "Signature":
                    signature = utf8(in.readUnsignedShort());
                    Signatures.collect(signature, dependencies);
                    break;
                case "InnerClasses": {
                    int n = in.readUnsignedShort();
                    for (int k = 0; k < n; k++) {
                        int inner = in.readUnsignedShort();
                        int outer = in.readUnsignedShort();
                        int simple = in.readUnsignedShort();
                        int flags = in.readUnsignedShort();
                        innerClasses.add(new InnerClass(
                                className(inner), outer == 0 ? null : className(outer),
                                simple == 0 ? null : utf8(simple), flags));
                    }
                    break;
                }
                case "EnclosingMethod": {
                    enclosingClass = className(in.readUnsignedShort());
                    in.readUnsignedShort();
                    dependencies.add(enclosingClass);
                    break;
                }
                case "BootstrapMethods": {
                    int n = in.readUnsignedShort();
                    for (int k = 0; k < n; k++) {
                        int handle = in.readUnsignedShort();
                        int argCount = in.readUnsignedShort();
                        int[] entry = new int[argCount + 1];
                        entry[0] = handle;
                        for (int a = 0; a < argCount; a++) entry[a + 1] = in.readUnsignedShort();
                        bootstrapMethods.add(entry);
                    }
                    break;
                }
                case "RuntimeVisibleAnnotations":
                    readAnnotations(in, annotations);
                    break;
                case "RuntimeVisibleTypeAnnotations":
                    readTypeAnnotations(in);
                    break;
                default:
                    in.skipBytes(length);
            }
        }
        // 부트스트랩 메서드(invokedynamic이 쓰는 것): 메서드 핸들과 인수 상수
        for (int[] entry : bootstrapMethods)
            for (int index : entry) constantUse(index);
        for (byte[] code : codes) walkCode(code);
        memberRefs.addAll(refs.values());
        dependencies.remove(name);
    }

    private Member readMember(DataInputStream in, boolean method) throws IOException {
        return readMember(in, method, null);
    }

    private Member readMember(DataInputStream in, boolean method, List<byte[]> codes) throws IOException {
        int flags = in.readUnsignedShort();
        Member member = new Member(flags, utf8(in.readUnsignedShort()), utf8(in.readUnsignedShort()));
        Signatures.collectDescriptor(member.descriptor, dependencies);
        int attributeCount = in.readUnsignedShort();
        for (int i = 0; i < attributeCount; i++) {
            String attribute = utf8(in.readUnsignedShort());
            int length = in.readInt();
            switch (attribute) {
                case "Signature":
                    member.signature = utf8(in.readUnsignedShort());
                    Signatures.collect(member.signature, dependencies);
                    break;
                case "ConstantValue":
                    member.constant = values[in.readUnsignedShort()];
                    if (member.constant == null) throw new IOException("bad ConstantValue in " + member);
                    break;
                case "Exceptions": {
                    int n = in.readUnsignedShort();
                    for (int k = 0; k < n; k++) {
                        String type = className(in.readUnsignedShort());
                        member.exceptions.add(type);
                        dependencies.add(type);
                    }
                    break;
                }
                case "Code": {
                    byte[] code = new byte[length];
                    in.readFully(code);
                    codes.add(code);
                    break;
                }
                case "AnnotationDefault": {
                    StringBuilder out = new StringBuilder();
                    readElementValue(in, out);
                    member.annotationDefault = out.toString();
                    break;
                }
                case "RuntimeVisibleAnnotations":
                    readAnnotations(in, member.annotations);
                    break;
                case "RuntimeVisibleParameterAnnotations": {
                    int parameters = in.readUnsignedByte();
                    for (int p = 0; p < parameters; p++) {
                        List<String> list = new ArrayList<>();
                        readAnnotations(in, list);
                        for (String a : list) member.annotations.add("param" + p + " " + a);
                    }
                    break;
                }
                case "RuntimeVisibleTypeAnnotations":
                    readTypeAnnotations(in);
                    break;
                default:
                    in.skipBytes(length);
            }
        }
        return member;
    }

    // ---- 상수 풀

    String utf8(int index) {
        if (tags[index] != UTF8) throw new IllegalStateException("constant " + index + " is not Utf8");
        return (String) values[index];
    }

    /** CONSTANT_Class의 이름(배열이면 서술자 그대로) */
    String className(int index) {
        if (tags[index] != CLASS) throw new IllegalStateException("constant " + index + " is not a Class");
        return utf8(refA[index]);
    }

    /** 클래스 상수를 의존에 넣는다(배열이면 원소 형식) */
    private void classUse(int index) {
        String type = className(index);
        if (type.startsWith("[")) Signatures.collectDescriptor(type, dependencies);
        else dependencies.add(type);
    }

    /** 코드·부트스트랩 인수가 쓰는 상수(ldc 등) */
    private void constantUse(int index) {
        switch (tags[index]) {
            case CLASS:
                classUse(index);
                break;
            case METHOD_TYPE:
                Signatures.collectDescriptor(utf8(refA[index]), dependencies);
                break;
            case METHOD_HANDLE: {
                int kind = refA[index];
                boolean isStatic = kind == 2 || kind == 4 || kind == 6;
                memberUse(refB[index], isStatic);
                break;
            }
            case DYNAMIC:
                Signatures.collectDescriptor(utf8(refB[refB[index]]), dependencies);
                break;
            default:
                break;
        }
    }

    /** Fieldref·Methodref·InterfaceMethodref 하나를 쓴다 */
    private void memberUse(int index, boolean isStatic) {
        int tag = tags[index];
        RefKind kind = tag == FIELDREF ? RefKind.FIELD : tag == METHODREF ? RefKind.METHOD : RefKind.INTERFACE_METHOD;
        if (tag != FIELDREF && tag != METHODREF && tag != IMETHODREF)
            throw new IllegalStateException("constant " + index + " is not a member reference");
        classUse(refA[index]);
        String owner = className(refA[index]);
        int nameAndType = refB[index];
        String memberName = utf8(refA[nameAndType]);
        String descriptor = utf8(refB[nameAndType]);
        Signatures.collectDescriptor(descriptor, dependencies);
        MemberRef ref = new MemberRef(owner, memberName, descriptor, kind, isStatic);
        refs.putIfAbsent(ref.key(), ref);
    }

    // ---- 코드

    private void walkCode(byte[] attribute) throws IOException {
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(attribute));
        in.readUnsignedShort();
        in.readUnsignedShort();
        int length = in.readInt();
        byte[] code = new byte[length];
        in.readFully(code);
        int pc = 0;
        while (pc < length) {
            int op = code[pc] & 0xff;
            switch (op) {
                case 0x12: // ldc
                    constantUse(code[pc + 1] & 0xff);
                    pc += 2;
                    break;
                case 0x13: // ldc_w
                case 0x14: // ldc2_w
                    constantUse(u2(code, pc + 1));
                    pc += 3;
                    break;
                case 0xb2: // getstatic
                case 0xb3: // putstatic
                case 0xb8: // invokestatic
                    memberUse(u2(code, pc + 1), true);
                    pc += 3;
                    break;
                case 0xb4: // getfield
                case 0xb5: // putfield
                case 0xb6: // invokevirtual
                case 0xb7: // invokespecial
                    memberUse(u2(code, pc + 1), false);
                    pc += 3;
                    break;
                case 0xb9: // invokeinterface
                    memberUse(u2(code, pc + 1), false);
                    pc += 5;
                    break;
                case 0xba: { // invokedynamic
                    int indy = u2(code, pc + 1);
                    Signatures.collectDescriptor(utf8(refB[refB[indy]]), dependencies);
                    pc += 5;
                    break;
                }
                case 0xbb: // new
                case 0xbd: // anewarray
                case 0xc0: // checkcast
                case 0xc1: // instanceof
                    classUse(u2(code, pc + 1));
                    pc += 3;
                    break;
                case 0xc5: // multianewarray
                    classUse(u2(code, pc + 1));
                    pc += 4;
                    break;
                case 0xaa: { // tableswitch
                    int p = (pc + 4) & ~3;
                    int low = s4(code, p + 4);
                    int high = s4(code, p + 8);
                    pc = p + 12 + (high - low + 1) * 4;
                    break;
                }
                case 0xab: { // lookupswitch
                    int p = (pc + 4) & ~3;
                    int pairs = s4(code, p + 4);
                    pc = p + 8 + pairs * 8;
                    break;
                }
                case 0xc4: // wide
                    pc += (code[pc + 1] & 0xff) == 0x84 ? 6 : 4;
                    break;
                default:
                    pc += instructionLength(op);
            }
        }
        int handlers = in.readUnsignedShort();
        for (int i = 0; i < handlers; i++) {
            in.readUnsignedShort();
            in.readUnsignedShort();
            in.readUnsignedShort();
            int catchType = in.readUnsignedShort();
            if (catchType != 0) classUse(catchType);
        }
        int attributes = in.readUnsignedShort();
        for (int i = 0; i < attributes; i++) {
            String attribute = utf8(in.readUnsignedShort());
            int attributeLength = in.readInt();
            if (attribute.equals("StackMapTable")) readStackMap(in);
            else if (attribute.equals("RuntimeVisibleTypeAnnotations")) readTypeAnnotations(in);
            else in.skipBytes(attributeLength);
        }
    }

    private static int instructionLength(int op) {
        if (op <= 0x0f) return 1;
        if (op == 0x10) return 2; // bipush
        if (op == 0x11) return 3; // sipush
        if (op >= 0x15 && op <= 0x19) return 2; // load n
        if (op >= 0x1a && op <= 0x35) return 1;
        if (op >= 0x36 && op <= 0x3a) return 2; // store n
        if (op >= 0x3b && op <= 0x83) return 1;
        if (op == 0x84) return 3; // iinc
        if (op >= 0x85 && op <= 0x98) return 1;
        if (op >= 0x99 && op <= 0xa8) return 3; // 분기
        if (op == 0xa9) return 2; // ret
        if (op >= 0xac && op <= 0xb1) return 1; // return
        if (op == 0xbc) return 2; // newarray
        if (op == 0xbe || op == 0xbf || op == 0xc2 || op == 0xc3) return 1;
        if (op == 0xc6 || op == 0xc7) return 3; // ifnull
        if (op == 0xc8 || op == 0xc9) return 5; // goto_w, jsr_w
        throw new IllegalStateException("unknown opcode 0x" + Integer.toHexString(op));
    }

    private static int u2(byte[] b, int i) {
        return ((b[i] & 0xff) << 8) | (b[i + 1] & 0xff);
    }

    private static int s4(byte[] b, int i) {
        return ((b[i] & 0xff) << 24) | ((b[i + 1] & 0xff) << 16) | ((b[i + 2] & 0xff) << 8) | (b[i + 3] & 0xff);
    }

    private void readStackMap(DataInputStream in) throws IOException {
        int frames = in.readUnsignedShort();
        for (int i = 0; i < frames; i++) {
            int type = in.readUnsignedByte();
            if (type < 64) continue;
            if (type < 128) {
                readVerificationType(in);
            } else if (type == 247) {
                in.readUnsignedShort();
                readVerificationType(in);
            } else if (type >= 248 && type <= 251) {
                in.readUnsignedShort();
            } else if (type >= 252 && type <= 254) {
                in.readUnsignedShort();
                for (int k = 0; k < type - 251; k++) readVerificationType(in);
            } else if (type == 255) {
                in.readUnsignedShort();
                int locals = in.readUnsignedShort();
                for (int k = 0; k < locals; k++) readVerificationType(in);
                int stack = in.readUnsignedShort();
                for (int k = 0; k < stack; k++) readVerificationType(in);
            } else {
                throw new IOException("bad stack map frame " + type);
            }
        }
    }

    private void readVerificationType(DataInputStream in) throws IOException {
        int tag = in.readUnsignedByte();
        if (tag == 7) classUse(in.readUnsignedShort());
        else if (tag == 8) in.readUnsignedShort();
    }

    // ---- 애너테이션

    private void readAnnotations(DataInputStream in, List<String> out) throws IOException {
        int n = in.readUnsignedShort();
        for (int i = 0; i < n; i++) {
            StringBuilder text = new StringBuilder();
            readAnnotation(in, text);
            out.add(text.toString());
        }
    }

    private void readAnnotation(DataInputStream in, StringBuilder out) throws IOException {
        String type = utf8(in.readUnsignedShort());
        Signatures.collectDescriptor(type, dependencies);
        out.append('@').append(type).append('(');
        int pairs = in.readUnsignedShort();
        for (int i = 0; i < pairs; i++) {
            if (i > 0) out.append(',');
            out.append(utf8(in.readUnsignedShort())).append('=');
            readElementValue(in, out);
        }
        out.append(')');
    }

    private void readElementValue(DataInputStream in, StringBuilder out) throws IOException {
        int tag = in.readUnsignedByte();
        switch (tag) {
            case 'B':
            case 'C':
            case 'D':
            case 'F':
            case 'I':
            case 'J':
            case 'S':
            case 'Z':
            case 's':
                out.append((char) tag).append(':').append(constantText(values[in.readUnsignedShort()]));
                break;
            case 'e': {
                String type = utf8(in.readUnsignedShort());
                Signatures.collectDescriptor(type, dependencies);
                out.append("e:").append(type).append('.').append(utf8(in.readUnsignedShort()));
                break;
            }
            case 'c': {
                String type = utf8(in.readUnsignedShort());
                Signatures.collectDescriptor(type, dependencies);
                out.append("c:").append(type);
                break;
            }
            case '@':
                readAnnotation(in, out);
                break;
            case '[': {
                int n = in.readUnsignedShort();
                out.append('{');
                for (int i = 0; i < n; i++) {
                    if (i > 0) out.append(',');
                    readElementValue(in, out);
                }
                out.append('}');
                break;
            }
            default:
                throw new IOException("bad element value tag " + (char) tag);
        }
    }

    private void readTypeAnnotations(DataInputStream in) throws IOException {
        int n = in.readUnsignedShort();
        for (int i = 0; i < n; i++) {
            int target = in.readUnsignedByte();
            switch (target) {
                case 0x00:
                case 0x01:
                case 0x16:
                    in.readUnsignedByte();
                    break;
                case 0x10:
                case 0x17:
                case 0x42:
                case 0x43:
                case 0x44:
                case 0x45:
                case 0x46:
                    in.readUnsignedShort();
                    break;
                case 0x11:
                case 0x12:
                    in.readUnsignedByte();
                    in.readUnsignedByte();
                    break;
                case 0x13:
                case 0x14:
                case 0x15:
                    break;
                case 0x40:
                case 0x41: {
                    int table = in.readUnsignedShort();
                    in.skipBytes(table * 6);
                    break;
                }
                case 0x47:
                case 0x48:
                case 0x49:
                case 0x4a:
                case 0x4b:
                    in.readUnsignedShort();
                    in.readUnsignedByte();
                    break;
                default:
                    throw new IOException("bad type annotation target 0x" + Integer.toHexString(target));
            }
            int path = in.readUnsignedByte();
            in.skipBytes(path * 2);
            readAnnotation(in, new StringBuilder());
        }
    }

    /** 상수 값의 정규 글자(실수는 비트 값으로, NaN은 하나로) */
    static String constantText(Object value) {
        if (value instanceof Float) {
            float f = (Float) value;
            return "float " + Integer.toHexString(Float.floatToIntBits(f)) + " (" + f + ")";
        }
        if (value instanceof Double) {
            double d = (Double) value;
            return "double " + Long.toHexString(Double.doubleToLongBits(d)) + " (" + d + ")";
        }
        if (value instanceof String) return "\"" + escape((String) value) + "\"";
        return value.getClass().getSimpleName().toLowerCase() + " " + value;
    }

    static String escape(String s) {
        StringBuilder out = new StringBuilder();
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c >= 0x20 && c < 0x7f) out.append(c);
            else out.append(String.format("\\u%04x", (int) c));
        }
        return out.toString();
    }

    // ---- 도움

    /** 패키지(내부 이름, 끝 슬래시 없음). 기본 패키지는 "". */
    static String packageOf(String internalName) {
        int slash = internalName.lastIndexOf('/');
        return slash < 0 ? "" : internalName.substring(0, slash);
    }

    /** 이 클래스를 직접 감싸는 클래스(중첩·지역·익명), 최상위면 null */
    String outerClass() {
        for (InnerClass entry : innerClasses) {
            if (entry.inner.equals(name)) {
                if (entry.outer != null) return entry.outer;
                return enclosingClass;
            }
        }
        return enclosingClass;
    }

    /** InnerClasses의 자기 항목으로 본 접근 수식어(중첩 클래스의 protected·private·static). 최상위면 access. */
    int declaredAccess() {
        for (InnerClass entry : innerClasses) if (entry.inner.equals(name)) return entry.access;
        return access;
    }

    /** 이 클래스가 선언한 멤버 클래스(InnerClasses에서 outer가 이 클래스인 것) */
    List<InnerClass> memberClasses() {
        List<InnerClass> list = new ArrayList<>();
        for (InnerClass entry : innerClasses)
            if (name.equals(entry.outer) && entry.simpleName != null) list.add(entry);
        return Collections.unmodifiableList(list);
    }

    boolean isInterface() {
        return (access & ACC_INTERFACE) != 0;
    }

    Member findField(String fieldName, String descriptor) {
        for (Member field : fields)
            if (field.name.equals(fieldName) && field.descriptor.equals(descriptor)) return field;
        return null;
    }

    Member findMethod(String methodName, String descriptor) {
        for (Member method : methods)
            if (method.name.equals(methodName) && method.descriptor.equals(descriptor)) return method;
        return null;
    }
}
