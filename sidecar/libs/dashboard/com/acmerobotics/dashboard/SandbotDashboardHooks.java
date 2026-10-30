package com.acmerobotics.dashboard;

import com.acmerobotics.dashboard.config.Config;
import com.acmerobotics.dashboard.config.reflection.ReflectionConfig;
import com.acmerobotics.dashboard.config.variable.CustomVariable;
import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.qualcomm.robotcore.eventloop.opmode.Disabled;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimDashboard;
import org.sandbot.sim.SimDashboardHost;

/**
 * SandBot: FtcDashboard와 런타임 사이(sim의 SimDashboard). 실제 DashboardCore의 전송 스레드·웹 소켓이 하던 일을 OpMode 스레드의
 * 틱 경계에서 한다(가상 시계라 결정적이다).
 *
 * <ul>
 *   <li>패킷: 실제 전송 스레드는 대기열이 비면 기다렸다가 오면 바로 보내고 전송 간격만큼 잔다. 그래서 대기열이 있고 지난 전송에서
 *       간격(가상)이 지난 첫 경계에 그때까지의 묶음을 보낸다. 묶음은 호스트 화면 의미대로 하나로 합친다(SandbotDashboardJson).
 *       clearTelemetry는 실제로 바로 빈 묶음을 보내므로 다음 경계에 cleared를 보낸다(간격과 관계없이).
 *   <li>설정 트리: 실제는 updateConfig마다 트리 전체를 보낸다. 바뀐 표시를 두고 다음 경계에 트리 전체를 보낸다
 *       (SandbotDashboardConfig, 이름순). withConfigRoot 안에서 시계를 써 경계가 오면 그 경계에서는 트리를 읽지 않는다.
 *   <li>Config 탭의 값 바꾸기(tickReply.configSet)는 경계에서 차례로 ValueProvider.set하고 트리를 다시 보낸다.
 *   <li>안내(카메라·이미지)는 실행마다 한 번.
 * </ul>
 *
 * <p>{@link #addConfigClasses}의 본문은 FTC Dashboard 0.6.0 FtcDashboard.addConfigClasses를 옮긴 것이다(MIT, 고지는
 * FtcDashboard.java의 머리말과 sidecar/NOTICE.txt).
 */
final class SandbotDashboardHooks implements SimDashboard {
    /** 실제 FtcDashboard.addConfigClasses가 건너뛰는 이름 접두(IGNORED_PACKAGES) */
    static final List<String> IGNORED_PACKAGES =
            Arrays.asList("java", "android", "com.sun", "com.vuforia", "com.google", "kotlin");

    private final FtcDashboard dashboard;
    private SimDashboardHost host;
    /** 다음 전송을 할 수 있는 가상 시각(전송 스레드의 잠) */
    private long nextSendNanos = Long.MIN_VALUE;
    /** 지난 전송 뒤 clearTelemetry가 있었다 */
    private boolean cleared;
    /** 설정 트리를 다시 보내야 한다 */
    private boolean configDirty;
    /** withConfigRoot 깊이(0이 아니면 경계에서 트리를 읽거나 바꾸지 않는다) */
    private int configDepth;
    /** 트리를 바꾸는 중에 온 값 바꾸기(다음 경계에) */
    private final List<List<String>> deferredPaths = new ArrayList<>();
    private final List<String> deferredValues = new ArrayList<>();
    private boolean cameraNoticed;
    private boolean imageNoticed;
    private final SandbotDashboardJson json = new SandbotDashboardJson();

    SandbotDashboardHooks(FtcDashboard dashboard) {
        this.dashboard = dashboard;
    }

    // ---- FtcDashboard가 부른다

    /** 1단계 규칙: Dashboard 상태는 OpMode 스레드만 바꾼다(다른 스레드면 시계가 thread 오류로 멈춘다) */
    void checkThread() {
        if (Sim.installed()) Sim.nanoTime();
    }

    void telemetryCleared() {
        cleared = true;
    }

    void configChanged() {
        configDirty = true;
    }

    void beginConfigChange() {
        configDepth++;
    }

    void endConfigChange() {
        configDepth--;
    }

    void notice(String code) {
        if (code.equals("dashCamera")) {
            if (cameraNoticed) return;
            cameraNoticed = true;
        } else {
            if (imageNoticed) return;
            imageNoticed = true;
        }
        if (host != null) host.notice(code);
    }

    // ---- SimDashboard(런타임이 부른다)

    @Override
    public void connect(SimDashboardHost host) {
        this.host = host;
    }

    @Override
    public void addConfigClasses(ClassLoader classLoader, List<String> names) {
        // 실제 FtcDashboard.addConfigClasses(생성자의 core.withConfigRoot 안). 클래스 목록은 APK의 DexFile 대신 런타임이 준다.
        dashboard.withConfigRoot(new CustomVariableConsumer() {
            @Override
            public void accept(CustomVariable customVariable) {
                for (String className : names) {
                    boolean skip = false;
                    for (String prefix : IGNORED_PACKAGES) {
                        if (className.startsWith(prefix)) {
                            skip = true;
                            break;
                        }
                    }

                    if (skip) {
                        continue;
                    }

                    try {
                        Class<?> configClass = Class.forName(className, false, classLoader);

                        if (!configClass.isAnnotationPresent(Config.class)
                            || configClass.isAnnotationPresent(Disabled.class)) {
                            continue;
                        }

                        String name = configClass.getSimpleName();
                        String altName = configClass.getAnnotation(Config.class).value();
                        if (!altName.isEmpty()) {
                            name = altName;
                        }

                        customVariable.putVariable(name,
                            ReflectionConfig.createVariableFromClass(configClass));
                    } catch (ClassNotFoundException | NoClassDefFoundError ignored) {
                        // dash is unable to access many classes and reporting every instance
                        // only clutters the logs
                    }
                }
            }
        });
    }

    @Override
    public void tickBoundary(long tNanos, List<List<String>> paths, List<String> values) {
        deferredPaths.addAll(paths);
        deferredValues.addAll(values);
        if (configDepth == 0 && !deferredPaths.isEmpty()) {
            List<List<String>> applyPaths = new ArrayList<>(deferredPaths);
            List<String> applyValues = new ArrayList<>(deferredValues);
            deferredPaths.clear();
            deferredValues.clear();
            // 팀의 ValueProvider.set이 시계를 써 경계가 와도 그 경계는 트리를 건드리지 않는다
            configDepth++;
            try {
                for (int i = 0; i < applyPaths.size(); i++) {
                    SandbotDashboardConfig.set(dashboard.configRoot, applyPaths.get(i), applyValues.get(i));
                }
            } finally {
                configDepth--;
            }
            // 받지 않은 값도 지금 값으로 되돌려 보이게
            configDirty = true;
        }
        sendTelemetry(tNanos, false);
        sendConfig(tNanos);
    }

    @Override
    public void flush(long tNanos) {
        sendTelemetry(tNanos, true);
        sendConfig(tNanos);
    }

    // ---- 보내기

    private void sendTelemetry(long tNanos, boolean all) {
        if (host == null) return;
        List<TelemetryPacket> pending = dashboard.pendingTelemetry;
        boolean due = !pending.isEmpty() && (all || tNanos >= nextSendNanos);
        if (!due && !cleared) return;
        List<TelemetryPacket> batch = new ArrayList<>();
        if (due) {
            batch.addAll(pending);
            pending.clear();
            long interval = Math.max(0, dashboard.telemetryTransmissionInterval);
            nextSendNanos = tNanos + interval * 1_000_000L;
        }
        boolean wasCleared = cleared;
        cleared = false;
        SandbotDashboardJson.Batch merged = json.batch(batch);
        host.dash(tNanos, wasCleared, merged.data, merged.log, merged.ops);
    }

    private void sendConfig(long tNanos) {
        if (host == null || !configDirty || configDepth != 0) return;
        configDirty = false;
        // 팀의 ValueProvider.get이 시계를 써 경계가 와도 그 경계는 트리를 건드리지 않는다
        configDepth++;
        String root;
        try {
            root = dashboard.configRoot.with(v -> {
                return json.config(v);
            });
        } finally {
            configDepth--;
        }
        host.dashConfig(tNanos, root);
    }
}
