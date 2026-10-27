package org.sandbot.tools;

import java.util.Set;

/** 서술자·Signature 속성(JVMS 4.7.9.1)에서 클래스 이름(내부 이름)을 모은다. */
final class Signatures {
    private Signatures() {}

    /** 필드·메서드 서술자의 클래스 형식(배열은 원소 형식) */
    static void collectDescriptor(String descriptor, Set<String> out) {
        int i = 0;
        while (i < descriptor.length()) {
            char c = descriptor.charAt(i);
            if (c == 'L') {
                int end = descriptor.indexOf(';', i);
                out.add(descriptor.substring(i + 1, end));
                i = end + 1;
            } else {
                i++;
            }
        }
    }

    /** 클래스·메서드·필드 Signature의 클래스 형식. 형식 변수(T…;)는 넣지 않는다. 중첩 형식은 Outer$Inner. */
    static void collect(String signature, Set<String> out) {
        new Parser(signature, out).any();
    }

    private static final class Parser {
        private final String s;
        private final Set<String> out;
        private int i;

        Parser(String s, Set<String> out) {
            this.s = s;
            this.out = out;
        }

        void any() {
            if (i < s.length() && s.charAt(i) == '<') typeParameters();
            if (i < s.length() && s.charAt(i) == '(') {
                i++;
                while (s.charAt(i) != ')') type();
                i++;
                type(); // 반환 형식(V 포함)
                while (i < s.length() && s.charAt(i) == '^') {
                    i++;
                    type();
                }
                return;
            }
            // 클래스 Signature(상위 클래스와 인터페이스) 또는 필드 Signature
            while (i < s.length()) type();
        }

        private void typeParameters() {
            i++; // <
            while (s.charAt(i) != '>') {
                int colon = s.indexOf(':', i);
                i = colon;
                // 클래스 경계는 비어 있을 수 있다(T::Ljava/lang/Comparable;)
                while (i < s.length() && s.charAt(i) == ':') {
                    i++;
                    if (s.charAt(i) != ':' && s.charAt(i) != '>') type();
                }
            }
            i++; // >
        }

        private void type() {
            char c = s.charAt(i);
            switch (c) {
                case 'L':
                    classType();
                    break;
                case 'T':
                    i = s.indexOf(';', i) + 1;
                    break;
                case '[':
                    i++;
                    type();
                    break;
                default:
                    i++; // 기본 형식·V
            }
        }

        private void classType() {
            i++; // L
            StringBuilder name = new StringBuilder();
            while (true) {
                char c = s.charAt(i);
                if (c == '<') {
                    out.add(name.toString());
                    typeArguments();
                } else if (c == '.') {
                    out.add(name.toString());
                    name.append('$');
                    i++;
                } else if (c == ';') {
                    out.add(name.toString());
                    i++;
                    return;
                } else {
                    name.append(c);
                    i++;
                }
            }
        }

        private void typeArguments() {
            i++; // <
            while (s.charAt(i) != '>') {
                char c = s.charAt(i);
                if (c == '*') {
                    i++;
                } else {
                    if (c == '+' || c == '-') i++;
                    type();
                }
            }
            i++; // >
        }
    }
}
