package org.sandbot.runtime;

import com.qualcomm.robotcore.eventloop.opmode.AnnotatedOpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.eventloop.opmode.Utility;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;
import org.sandbot.sim.SimExit;
import org.sandbot.sim.SimThreadError;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * {@code @OpModeRegistrar} 메서드를 실제 SDK 12.0처럼 부르고(AnnotatedOpModeClassFilter.filterOpModeRegistrarMethods·
 * callOpModeRegistrarMethods) 등록을 모으는 관리자(OpModeRegistrarMethodManager). OpMode 스레드에서 쓴다.
 *
 * <ul>
 *   <li>메서드: 선언 메서드 중 public static이고 abstract가 아니며 {@code @OpModeRegistrar}가 있고 매개변수가 1개(관리자) 또는
 *       2개(Context, 관리자)인 것. Context는 null이다(Android 앱이 없다).
 *   <li>순서: 등록기 클래스 이름 순, 한 클래스 안은 메서드 이름 순(실제는 HashSet 순서). 시계는 돌지만 hardwareMap은 아직 없다.
 *   <li>던지면 실제는 조용히 무시하지만 사이드카는 {@link Errors}로 알리고(error kind registrar) 다음으로 간다. 던지기 전에 한
 *       등록은 남는다(실제와 같다). System.exit(SimExit)·다른 스레드(SimThreadError)는 실행을 끝내므로 그대로 나간다.
 *   <li>register 다섯 가지의 확인은 실제 OpModeRegistrarMethodManager와 같다(OpMode 상속, static이 아닌 중첩 클래스·public이
 *       아닌 클래스는 설정 오류 로그, 이름은 OpModeMeta.nameIsLegalForOpMode). 이름이 없으면 실제처럼 RuntimeException이 등록기
 *       밖으로 나간다(OpModeMeta.Builder.build).
 *   <li>SandBot에서 정한 것: 등록은 부른 순서대로 모으고, 이미 있는 이름(또는 이미 등록한 클래스)이면 뒤의 것을 버리고 경고
 *       로그를 남긴다. 실제는 인스턴스는 버리지만 클래스는 모든 등록기가 끝난 뒤 이름 뒤에 "-클래스 이름"을 붙여 둘 다 남긴다.
 * </ul>
 */
final class RegistrarRunner implements AnnotatedOpModeManager {
    /** 실제 AnnotatedOpModeClassFilter.TAG */
    static final String TAG = "OpmodeRegistration";
    /** 실제 AnnotatedOpModeClassFilter.BUILTIN_PACKAGE_PREFIX(이름 뒤에 " (Built-in)") */
    static final String BUILTIN_PACKAGE_PREFIX = "org.firstinspires.ftc.robotcontroller.external.utilities";

    /** 등록기 하나가 던졌다(메시지는 영어) */
    interface Errors {
        void registrarFailed(String registrar, String message, Throwable thrown);
    }

    /** 등록 하나. 클래스 등록이면 instance가 null이다. */
    static final class Registration {
        final OpModeMeta meta;
        final Class<?> opModeClass;
        final OpMode instance;
        /** 등록한 등록기 클래스(바이너리 이름) */
        final String registrar;

        Registration(OpModeMeta meta, Class<?> opModeClass, OpMode instance, String registrar) {
            this.meta = meta;
            this.opModeClass = opModeClass;
            this.instance = instance;
            this.registrar = registrar;
        }

        /** 등록한 OpMode 클래스(인스턴스면 그 런타임 클래스) */
        String className() {
            return instance != null ? instance.getClass().getName() : opModeClass.getName();
        }

        /** sidecarProtocol RegisteredOpMode */
        Map<String, Object> toJson() {
            return Json.obj("name", meta.name, "group", meta.group, "flavor", flavorName(meta.flavor), "className",
                    className(), "registrar", registrar, "transitionTarget",
                    meta.autoTransition == null ? "" : meta.autoTransition);
        }
    }

    private final List<Registration> registrations = new ArrayList<>();
    private final Map<String, Registration> byName = new HashMap<>();
    /** 지금 부르는 등록기 클래스 */
    private String current = "";

    static String quote(String text) {
        return "\"" + text + "\"";
    }

    static String flavorName(OpModeMeta.Flavor flavor) {
        switch (flavor) {
            case AUTONOMOUS:
                return "Autonomous";
            case UTILITY:
                return "Utility";
            case SYSTEM:
                return "System";
            default:
                return "TeleOp";
        }
    }

    /** 부른 순서대로 모은 등록 */
    List<Registration> registrations() {
        return Collections.unmodifiableList(registrations);
    }

    /** DS 이름으로 찾는다. 없으면 null. */
    Registration find(String name) {
        return byName.get(name);
    }

    List<Map<String, Object>> toJson() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Registration r : registrations) out.add(r.toJson());
        return out;
    }

    /**
     * 등록기 클래스(바이너리 이름, 같은 이름은 한 번)를 이름 순으로, 그 안의 등록기 메서드를 이름 순으로 부른다. 클래스는 이 로더로
     * 찾고, 정적 초기화는 메서드를 부를 때(팀 코드) 돈다.
     */
    void runAll(List<String> registrarClasses, ClassLoader loader, Errors errors) {
        for (String className : new TreeSet<>(registrarClasses)) {
            current = className;
            Class<?> type;
            List<Method> methods;
            try {
                type = Class.forName(className, false, loader);
                methods = registrarMethods(type);
            } catch (ClassNotFoundException e) {
                errors.registrarFailed(className, "The registrar class " + className
                        + " was not found in the compiled TeamCode", null);
                continue;
            } catch (LinkageError e) {
                rethrowFatal(e);
                errors.registrarFailed(className, "The registrar class " + className + " could not be loaded: "
                        + StackFrames.describe(e), e);
                continue;
            }
            for (Method method : methods) call(method, errors);
        }
        current = "";
    }

    /** 실제 filterOpModeRegistrarMethods의 규칙. 순서는 이름 → 매개변수 수 → 서명. */
    static List<Method> registrarMethods(Class<?> type) {
        List<Method> found = new ArrayList<>();
        int required = Modifier.STATIC | Modifier.PUBLIC;
        for (Method method : type.getDeclaredMethods()) {
            int modifiers = method.getModifiers();
            if ((modifiers & required) != required || Modifier.isAbstract(modifiers)) continue;
            if (!method.isAnnotationPresent(OpModeRegistrar.class)) continue;
            int count = method.getParameterCount();
            if (count == 1 || count == 2) found.add(method);
        }
        found.sort(Comparator.comparing(Method::getName).thenComparingInt(Method::getParameterCount)
                .thenComparing(Method::toGenericString));
        return found;
    }

    private void call(Method method, Errors errors) {
        String where = method.getDeclaringClass().getName() + "." + method.getName();
        try {
            if (method.getParameterCount() == 1) method.invoke(null, this);
            else method.invoke(null, null, this);
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            rethrowFatal(cause);
            errors.registrarFailed(current, "The @OpModeRegistrar method " + where + " threw "
                    + StackFrames.describe(cause), cause);
        } catch (ExceptionInInitializerError e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            rethrowFatal(cause);
            errors.registrarFailed(current, "Initializing the class of the @OpModeRegistrar method " + where
                    + " failed: " + StackFrames.describe(cause), cause);
        } catch (IllegalAccessException | IllegalArgumentException e) {
            // 매개변수 형식이 관리자가 아니다(실제도 부르지 못하고 무시한다)
            errors.registrarFailed(current, "The @OpModeRegistrar method " + where
                    + " cannot be called with an OpModeManager: " + StackFrames.describe(e), null);
        } catch (Throwable t) {
            rethrowFatal(t);
            errors.registrarFailed(current, "The @OpModeRegistrar method " + where + " failed: "
                    + StackFrames.describe(t), t);
        }
    }

    private static void rethrowFatal(Throwable t) {
        if (t instanceof SimExit) throw (SimExit) t;
        if (t instanceof SimThreadError) throw (SimThreadError) t;
    }

    // ---- OpModeRegistrarMethodManager ----

    @Override
    @SuppressWarnings({"rawtypes", "unchecked"})
    public void register(Class clazz) {
        if (checkOpModeClassConstraints(clazz) && checkUserOpModeName(clazz, null)) addAnnotatedOpMode(clazz);
    }

    @Override
    public void register(String name, Class<? extends OpMode> clazz) {
        if (checkOpModeClassConstraints(clazz) && checkUserOpModeName(clazz, name))
            addClass(new OpModeMeta.Builder().setName(name).build(), clazz);
    }

    @Override
    public void register(OpModeMeta meta, Class<? extends OpMode> clazz) {
        // We do not need to check the name, because the OpModeMeta builder handles that.
        if (checkOpModeClassConstraints(clazz)) addClass(meta, clazz);
    }

    @Override
    public void register(String name, OpMode opModeInstance) {
        if (checkUserOpModeName(opModeInstance.getClass(), name))
            addInstance(new OpModeMeta.Builder().setName(name).build(), opModeInstance);
    }

    @Override
    public void register(OpModeMeta meta, OpMode opModeInstance) {
        addInstance(meta, opModeInstance);
    }

    /** 실제 addAnnotatedOpMode·addOpModeWithGroupName: 애너테이션에서 flavor·이름·group·preselectTeleOp(@Disabled는 보지 않는다) */
    private void addAnnotatedOpMode(Class<?> clazz) {
        OpModeMeta.Builder builder = new OpModeMeta.Builder();
        if (clazz.isAnnotationPresent(TeleOp.class)) {
            TeleOp annotation = clazz.getAnnotation(TeleOp.class);
            builder.setFlavor(OpModeMeta.Flavor.TELEOP).setGroup(annotation.group());
        } else if (clazz.isAnnotationPresent(Autonomous.class)) {
            Autonomous annotation = clazz.getAnnotation(Autonomous.class);
            String preselect = annotation.preselectTeleOp().isEmpty() ? null : annotation.preselectTeleOp();
            builder.setFlavor(OpModeMeta.Flavor.AUTONOMOUS).setGroup(annotation.group()).setTransitionTarget(preselect);
        } else if (clazz.isAnnotationPresent(Utility.class)) {
            Utility annotation = clazz.getAnnotation(Utility.class);
            builder.setFlavor(OpModeMeta.Flavor.UTILITY).setGroup("").setDescription(annotation.description());
        } else {
            // TeleOp·Autonomous·Utility가 없으면 등록하지 않는다(AnnotatedOpModeManager.register(Class))
            return;
        }
        addClass(builder.setName(opModeName(clazz)).build(), clazz);
    }

    /** 실제 getOpModeName(클래스 이름 덮어쓰기 없이) */
    static String opModeName(Class<?> clazz) {
        String name;
        if (clazz.isAnnotationPresent(TeleOp.class)) name = clazz.getAnnotation(TeleOp.class).name();
        else if (clazz.isAnnotationPresent(Autonomous.class)) name = clazz.getAnnotation(Autonomous.class).name();
        else if (clazz.isAnnotationPresent(Utility.class)) name = clazz.getAnnotation(Utility.class).name();
        else name = clazz.getSimpleName();
        if (name.trim().equals("")) name = clazz.getSimpleName();
        if (clazz.getPackage() != null && clazz.getPackage().getName().startsWith(BUILTIN_PACKAGE_PREFIX))
            name += " (Built-in)";
        return name;
    }

    /** 실제 addToOpModeGroup: 빈 group은 기본 그룹. 같은 클래스는 한 번만. */
    private void addClass(OpModeMeta meta, Class<?> clazz) {
        for (Registration r : registrations) {
            if (r.instance == null && r.opModeClass == clazz) {
                duplicate("the OpMode class " + clazz.getName() + " is already registered as '" + r.meta.name + "'");
                return;
            }
        }
        OpModeMeta grouped = meta.group.isEmpty()
                ? OpModeMeta.Builder.wrap(meta).setGroup(OpModeMeta.DefaultGroup).build()
                : meta;
        add(new Registration(grouped, clazz, null, current));
    }

    private void addInstance(OpModeMeta meta, OpMode instance) {
        add(new Registration(meta, null, instance, current));
    }

    private void add(Registration registration) {
        String name = registration.meta.name;
        if (byName.containsKey(name)) {
            duplicate("an OpMode with the name '" + name + "' is already registered");
            return;
        }
        byName.put(name, registration);
        registrations.add(registration);
    }

    private static void duplicate(String what) {
        RobotLog.ww("RegisteredOpModes", "configuration error: %s; the later registration is ignored", what);
    }

    // ---- 실제 AnnotatedOpModeClassFilter의 확인 ----

    private static boolean checkOpModeClassConstraints(Class<?> clazz) {
        // If the class doesn't extend OpMode, that's an error, we'll ignore the class
        if (!OpMode.class.isAssignableFrom(clazz)) {
            configurationError("'%s' class doesn't inherit from the class 'OpMode'", clazz.getSimpleName());
            return false;
        }
        // If the class is an inner class it can't be instantiated and will fail silently.
        if (clazz.getEnclosingClass() != null && !Modifier.isStatic(clazz.getModifiers())) {
            configurationError("'%s' class is an inner class.  Inner classes can not be run as OpModes",
                    clazz.getSimpleName());
            return false;
        }
        // If it's not 'public', it can't be loaded by the system and won't work.
        if (!Modifier.isPublic(clazz.getModifiers())) {
            configurationError("'%s' class is not declared 'public'", clazz.getSimpleName());
            return false;
        }
        return true;
    }

    private static boolean checkUserOpModeName(Class<?> clazz, String opModeName) {
        if (opModeName == null) opModeName = opModeName(clazz);
        if (!OpModeMeta.nameIsLegalForOpMode(opModeName, false)) {
            configurationError("\"%s\" is not a legal OpMode name", opModeName);
            return false;
        }
        return true;
    }

    /** 실제 reportOpModeConfigurationError의 로그(DS의 전역 오류 표시는 없다) */
    private static void configurationError(String format, Object... args) {
        RobotLog.ww(TAG, "configuration error: %s", String.format(format, args));
    }
}
