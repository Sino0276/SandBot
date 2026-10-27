package org.sandbot.runtime.patch;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 클래스 파일을 패치에 필요한 만큼만 읽는다(ASM 없이): 상수 풀 항목의 위치와, 메서드마다 Code 속성의 바이트코드 위치.
 * 바이트 배열은 고치지 않는다(ClassPatcher가 복사본을 고친다).
 */
final class ClassFile {
    static final int UTF8 = 1;
    static final int INTEGER = 3;
    static final int FLOAT = 4;
    static final int LONG = 5;
    static final int DOUBLE = 6;
    static final int CLASS = 7;
    static final int STRING = 8;
    static final int FIELDREF = 9;
    static final int METHODREF = 10;
    static final int INTERFACE_METHODREF = 11;
    static final int NAME_AND_TYPE = 12;
    static final int METHOD_HANDLE = 15;
    static final int METHOD_TYPE = 16;
    static final int DYNAMIC = 17;
    static final int INVOKE_DYNAMIC = 18;
    static final int MODULE = 19;
    static final int PACKAGE = 20;

    static final int ACC_INTERFACE = 0x0200;

    /** 지원하는 가장 낮은 주 버전(JDK 1.1) */
    static final int MIN_MAJOR = 45;
    /** 지원하는 가장 높은 주 버전: 지금 실행 중인 JDK의 버전(17이면 61) */
    static final int MAX_MAJOR = 44 + Runtime.version().feature();

    final byte[] b;
    final int major;
    /** 상수 풀 크기(constant_pool_count, 항목 수 + 1) */
    final int cpCount;
    /** 항목 i의 태그 위치(0이면 빈 칸: 0번, long·double 다음 칸) */
    final int[] cpOffset;
    /** 상수 풀이 끝나는 위치(access_flags 시작) */
    final int cpEnd;
    final int accessFlags;
    final String thisName;
    final String superName;
    /** 메서드의 Code 속성 안 바이트코드 [시작, 끝) 목록 */
    final List<int[]> codeRanges = new ArrayList<>();
    final Set<String> methods = new HashSet<>();

    ClassFile(byte[] bytes) throws PatchException {
        this.b = bytes;
        try {
            if (u4(0) != 0xCAFEBABE) throw new PatchException("not a class file (bad magic)");
            major = u2(6);
            if (major < MIN_MAJOR || major > MAX_MAJOR)
                throw new PatchException("unsupported class file version " + major + " (supported "
                        + MIN_MAJOR + "-" + MAX_MAJOR + ")");
            cpCount = u2(8);
            cpOffset = new int[cpCount];
            int p = 10;
            for (int i = 1; i < cpCount; i++) {
                cpOffset[i] = p;
                int tag = u1(p);
                switch (tag) {
                    case UTF8:
                        p += 3 + u2(p + 1);
                        break;
                    case INTEGER:
                    case FLOAT:
                    case FIELDREF:
                    case METHODREF:
                    case INTERFACE_METHODREF:
                    case NAME_AND_TYPE:
                    case DYNAMIC:
                    case INVOKE_DYNAMIC:
                        p += 5;
                        break;
                    case LONG:
                    case DOUBLE:
                        p += 9;
                        i++;
                        break;
                    case CLASS:
                    case STRING:
                    case METHOD_TYPE:
                    case MODULE:
                    case PACKAGE:
                        p += 3;
                        break;
                    case METHOD_HANDLE:
                        p += 4;
                        break;
                    default:
                        throw new PatchException("bad constant pool tag " + tag + " at entry " + i);
                }
            }
            cpEnd = p;
            accessFlags = u2(p);
            thisName = className(u2(p + 2));
            int superIndex = u2(p + 4);
            superName = superIndex == 0 ? null : className(superIndex);
            p += 6;
            int interfaces = u2(p);
            p += 2 + 2 * interfaces;
            p = skipMembers(p, false);
            p = skipMembers(p, true);
            int attributes = u2(p);
            p += 2;
            for (int i = 0; i < attributes; i++) p += 6 + u4(p + 2);
            if (p != b.length) throw new PatchException("trailing bytes after class file end");
        } catch (ArrayIndexOutOfBoundsException e) {
            throw new PatchException("truncated class file");
        }
    }

    static ClassInfo readInfo(byte[] bytes) throws PatchException {
        ClassFile cf = new ClassFile(bytes);
        return new ClassInfo(cf.thisName, cf.superName, (cf.accessFlags & ACC_INTERFACE) != 0, cf.methods);
    }

    private int skipMembers(int p, boolean isMethods) throws PatchException {
        int count = u2(p);
        p += 2;
        for (int i = 0; i < count; i++) {
            String name = utf8(u2(p + 2));
            String desc = utf8(u2(p + 4));
            if (isMethods) methods.add(name + desc);
            int attributes = u2(p + 6);
            p += 8;
            for (int a = 0; a < attributes; a++) {
                int length = u4(p + 2);
                if (isMethods && "Code".equals(utf8(u2(p)))) {
                    int codeLength = u4(p + 10);
                    int start = p + 14;
                    if (codeLength < 0 || start + codeLength > p + 6 + length)
                        throw new PatchException("bad Code attribute in " + name + desc);
                    codeRanges.add(new int[] {start, start + codeLength});
                }
                p += 6 + length;
            }
        }
        return p;
    }

    int tag(int index) {
        return u1(cpOffset[index]);
    }

    String utf8(int index) throws PatchException {
        if (index <= 0 || index >= cpCount || cpOffset[index] == 0 || tag(index) != UTF8)
            throw new PatchException("constant pool entry " + index + " is not Utf8");
        int p = cpOffset[index];
        return decodeModifiedUtf8(b, p + 3, u2(p + 1));
    }

    String className(int classIndex) throws PatchException {
        if (classIndex <= 0 || classIndex >= cpCount || tag(classIndex) != CLASS)
            throw new PatchException("constant pool entry " + classIndex + " is not a Class");
        return utf8(u2(cpOffset[classIndex] + 1));
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

    /** 클래스 파일의 "수정된 UTF-8"(JVMS 4.4.7) */
    static String decodeModifiedUtf8(byte[] b, int start, int length) throws PatchException {
        StringBuilder out = new StringBuilder(length);
        int p = start;
        int end = start + length;
        while (p < end) {
            int c = b[p] & 0xFF;
            if (c < 0x80 && c != 0) {
                out.append((char) c);
                p++;
            } else if ((c & 0xE0) == 0xC0 && p + 1 < end) {
                out.append((char) (((c & 0x1F) << 6) | (b[p + 1] & 0x3F)));
                p += 2;
            } else if ((c & 0xF0) == 0xE0 && p + 2 < end) {
                out.append((char) (((c & 0x0F) << 12) | ((b[p + 1] & 0x3F) << 6) | (b[p + 2] & 0x3F)));
                p += 3;
            } else {
                throw new PatchException("bad modified UTF-8 in constant pool");
            }
        }
        return out.toString();
    }

    /** 수정된 UTF-8로 쓴다(우리가 넣는 이름은 ASCII뿐이지만 일반적으로) */
    static byte[] encodeModifiedUtf8(String s) {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != 0 && c < 0x80) {
                out.write(c);
            } else if (c < 0x800) {
                out.write(0xC0 | (c >> 6));
                out.write(0x80 | (c & 0x3F));
            } else {
                out.write(0xE0 | (c >> 12));
                out.write(0x80 | ((c >> 6) & 0x3F));
                out.write(0x80 | (c & 0x3F));
            }
        }
        return out.toByteArray();
    }
}
