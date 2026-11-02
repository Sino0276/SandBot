package com.acmerobotics.dashboard.config.reflection;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;

/**
 * SandBot: 로봇(Android ART)의 리플렉션 필드 접근 규칙으로 Dashboard가 필드를 읽고 쓴다(ReflectionConfig·FieldProvider·
 * ArrayProvider).
 *
 * <p>ART(art/runtime/reflection.cc의 VerifyAccess)는 멤버가 public이면 선언 클래스가 public인지 보지 않고 허락한다. HotSpot은
 * 선언 클래스가 public이 아니면 같은 패키지에서만 허락하므로, Dashboard 패키지에서 public이 아닌 팀 @Config 클래스(패키지 전용
 * 최상위, public이 아닌 중첩 클래스, 패키지 전용 상위 클래스에서 물려받은 public 필드)를 읽고 쓰면 IllegalAccessException이다.
 * 그런 필드만 접근 검사를 끈 사본(같은 필드의 다른 Field 객체, setAccessible)으로 읽고 쓰고, 받은 Field는 바꾸지 않는다.
 * ART의 Field.set은 접근 검사보다 먼저 final 필드를 거부하므로(setAccessible하지 않았으면) 사본으로 쓸 때도 final은 거부한다.
 * public 클래스의 필드는 실제와 같은 길(받은 Field 그대로)이다.
 */
final class SandbotFieldAccess {
    private SandbotFieldAccess() {}

    static Object get(Field field, Object parent) throws IllegalAccessException {
        return usable(field).get(parent);
    }

    static void set(Field field, Object parent, Object value) throws IllegalAccessException {
        Field usable = usable(field);
        if (usable != field && Modifier.isFinal(field.getModifiers())) {
            String owner = field.getDeclaringClass().getName();
            throw new IllegalAccessException("Cannot set " + Modifier.toString(field.getModifiers()) + " field "
                    + field.getType().getName() + " " + owner + "." + field.getName() + " of class " + owner);
        }
        usable.set(parent, value);
    }

    /** HotSpot이 막지만 ART는 허락하는 필드면 접근 검사를 끈 사본, 아니면 그대로 */
    private static Field usable(Field field) {
        if (field.isAccessible() || !Modifier.isPublic(field.getModifiers())
                || Modifier.isPublic(field.getDeclaringClass().getModifiers())) {
            return field;
        }
        try {
            Field copy = field.getDeclaringClass().getDeclaredField(field.getName());
            copy.setAccessible(true);
            return copy;
        } catch (NoSuchFieldException | RuntimeException e) {
            // 모듈이 막는 JDK 클래스 등: 실제처럼 받은 Field로(접근 오류가 그대로 난다)
            return field;
        }
    }
}
