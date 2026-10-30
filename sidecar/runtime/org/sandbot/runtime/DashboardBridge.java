package org.sandbot.runtime;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;

import org.sandbot.sim.Sim;
import org.sandbot.sim.SimDashboard;
import org.sandbot.sim.SimDashboardHost;

import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * FTC Dashboard 대체(sandbot-dashboard.jar, 라이브러리 L2)와 런타임 사이. 실행 클래스패스에 FtcDashboard가 있으면 OpMode
 * 스레드에서:
 *
 * <ol>
 *   <li>{@link #start}: FtcDashboard 클래스를 초기화하고(getInstance가 null이 아니게, 등록기보다 먼저), 컴파일한 팀 클래스와
 *       라이브러리 클래스 중 @Config가 있을 수 있는 것(상수 풀에 그 애너테이션이 있는 것)을 Dashboard에 넘겨 설정 트리를 만든다
 *       (실제 addConfigClasses, 정적 초기화는 그때 돈다).
 *   <li>OpMode 수명 알림({@link #preInit}·{@link #preStart}·{@link #postStop}): 실제 OpModeManagerImpl이 리스너에게 하듯
 *       OpModeManagerNotifier.Notifications로 부른다.
 *   <li>틱 경계({@link #tickBoundary}): tickReply.configSet을 적용하고, 보낼 때가 된 패킷 묶음과 바뀐 설정 트리를 보낸다.
 *   <li>끝({@link #flush}): 남은 것을 보낸다.
 * </ol>
 * Dashboard가 만든 JSON 글자는 Protocol의 dash·dashConfig·notice로 내보낸다. 실제(Android) FtcDashboard가 클래스패스에 있으면
 * Sim에 붙지 않으므로 아무것도 하지 않는다.
 */
final class DashboardBridge implements SimDashboardHost {
    static final String DASHBOARD_CLASS = "com.acmerobotics.dashboard.FtcDashboard";
    private static final String DASHBOARD_ENTRY = "com/acmerobotics/dashboard/FtcDashboard";
    /** 클래스 파일 상수 풀의 @Config 서술자(런타임에 보이는 애너테이션이면 이 글자가 있다) */
    private static final byte[] CONFIG_DESCRIPTOR =
            "Lcom/acmerobotics/dashboard/config/Config;".getBytes(StandardCharsets.UTF_8);
    /** 실제 addConfigClasses가 건너뛰는 이름 접두(Dashboard도 다시 본다. 여기서는 큰 jar의 바이트를 읽지 않으려고) */
    private static final String[] IGNORED_PREFIXES = {"java", "android", "com.sun", "com.vuforia", "com.google", "kotlin"};

    private final Protocol protocol;
    private final VirtualClock clock;
    private final List<String> candidates;
    private SimDashboard hooks;
    private OpModeManagerNotifier.Notifications listener;

    private DashboardBridge(Protocol protocol, VirtualClock clock, List<String> candidates) {
        this.protocol = protocol;
        this.clock = clock;
        this.candidates = candidates;
    }

    /**
     * 라이브러리 jar에 FtcDashboard가 있으면 다리, 없으면 null. @Config 후보는 여기서 바이트로 고른다(클래스를 불러오지 않는다).
     *
     * @param teamClasses 컴파일한 팀 클래스(바이너리 이름 → 클래스 파일)
     */
    static DashboardBridge find(LibraryJars libraries, Map<String, byte[]> teamClasses, Protocol protocol,
            VirtualClock clock) throws IOException {
        if (libraries == null) return null;
        boolean present = false;
        for (LibraryJars.Jar jar : libraries.jars) {
            if (jar.classBytes(DASHBOARD_ENTRY) != null) {
                present = true;
                break;
            }
        }
        if (!present) return null;
        TreeSet<String> names = new TreeSet<>();
        for (Map.Entry<String, byte[]> e : teamClasses.entrySet())
            if (!ignored(e.getKey()) && contains(e.getValue(), CONFIG_DESCRIPTOR)) names.add(e.getKey());
        for (LibraryJars.Jar jar : libraries.jars) {
            for (String internal : jar.classNames()) {
                String name = internal.replace('/', '.');
                if (ignored(name) || names.contains(name)) continue;
                byte[] bytes = jar.classBytes(internal);
                if (bytes != null && contains(bytes, CONFIG_DESCRIPTOR)) names.add(name);
            }
        }
        return new DashboardBridge(protocol, clock, Collections.unmodifiableList(new ArrayList<>(names)));
    }

    private static boolean ignored(String name) {
        for (String prefix : IGNORED_PREFIXES) if (name.startsWith(prefix)) return true;
        return false;
    }

    static boolean contains(byte[] haystack, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= haystack.length; i++) {
            for (int j = 0; j < needle.length; j++) if (haystack[i + j] != needle[j]) continue outer;
            return true;
        }
        return false;
    }

    /** @Config 후보(시험용) */
    List<String> candidates() {
        return candidates;
    }

    // ---- OpMode 스레드

    /**
     * FtcDashboard를 초기화하고 @Config 클래스를 찾는다. 트리에 넣은 @Config 클래스는 여기서 초기화되고(필드가 기본 형식뿐이어도),
     * 팀 코드의 정적 초기화가 던진 것은 그대로 던진다(OpMode 오류로 알린다).
     */
    void start(ClassLoader loader) throws Throwable {
        Class<?> type;
        try {
            type = Class.forName(DASHBOARD_CLASS, true, loader);
        } catch (ClassNotFoundException e) {
            return;
        }
        hooks = Sim.dashboard();
        if (hooks == null) return;
        try {
            Object instance = type.getMethod("getInstance").invoke(null);
            if (instance instanceof OpModeManagerNotifier.Notifications)
                listener = (OpModeManagerNotifier.Notifications) instance;
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
        hooks.connect(this);
        try {
            hooks.addConfigClasses(loader, candidates);
        } catch (Throwable t) {
            // 시작하지 못했다(실행이 끝난다): 끝낼 때 트리를 보내지 않는다(초기화에 실패한 클래스를 읽으면 경고만 는다)
            hooks = null;
            listener = null;
            throw t;
        }
    }

    boolean active() {
        return hooks != null;
    }

    /** OpMode를 만든 뒤 init 전(OpModeManagerImpl.callActiveOpModeInit의 리스너) */
    void preInit(OpMode opMode) {
        if (listener != null) listener.onOpModePreInit(opMode);
    }

    /** START를 적용하기 전(callActiveOpModeStart의 리스너) */
    void preStart(OpMode opMode) {
        if (listener != null) listener.onOpModePreStart(opMode);
    }

    /** OpMode가 끝난 뒤(callActiveOpModeStop의 리스너) */
    void postStop(OpMode opMode) {
        if (listener != null) listener.onOpModePostStop(opMode);
    }

    /**
     * 틱 경계(OpModeRunner.onTick, 답을 받은 뒤): configSet(tickReply의 {path, value} 배열)을 Dashboard에 넘기고 패킷·설정 트리를
     * 보내게 한다. 모양이 틀린 항목은 버린다(호스트가 이미 확인했다).
     */
    void tickBoundary(long tNanos, Object configSet) {
        if (hooks == null) return;
        List<List<String>> paths = new ArrayList<>();
        List<String> values = new ArrayList<>();
        if (configSet instanceof List) {
            for (Object item : (List<?>) configSet) {
                if (!(item instanceof Map)) continue;
                Object path = ((Map<?, ?>) item).get("path");
                Object value = ((Map<?, ?>) item).get("value");
                if (!(path instanceof List) || !(value instanceof String)) continue;
                List<String> names = new ArrayList<>();
                boolean ok = !((List<?>) path).isEmpty();
                for (Object name : (List<?>) path) {
                    if (name instanceof String) names.add((String) name);
                    else ok = false;
                }
                if (!ok) continue;
                paths.add(names);
                values.add((String) value);
            }
        }
        hooks.tickBoundary(tNanos, paths, values);
    }

    void flush(long tNanos) {
        if (hooks != null) hooks.flush(tNanos);
    }

    // ---- SimDashboardHost

    @Override
    public void dash(long tNanos, boolean cleared, String data, String log, String ops) {
        protocol.dash(tNanos, cleared, data, log, ops);
    }

    @Override
    public void dashConfig(long tNanos, String root) {
        protocol.dashConfig(tNanos, root);
    }

    @Override
    public void notice(String code) {
        protocol.notice(clock.peekNanos(), code, new TreeMap<String, String>());
    }
}
