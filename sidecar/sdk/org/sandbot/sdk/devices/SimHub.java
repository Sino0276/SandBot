package org.sandbot.sdk.devices;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.hardware.Blinker;
import com.qualcomm.robotcore.hardware.LynxModuleImuType;

import org.sandbot.sim.HubKind;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimCost;
import org.sandbot.sim.SimDevice;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/**
 * 허브 하나(Control Hub 또는 Expansion Hub, 구성의 LynxModule 하나)의 시뮬레이션 상태.
 *
 * <ul>
 *   <li>비용: Lynx 명령·bulk read·I2C 트랜잭션마다 {@link Sim#charge}로 가상 시간을 보낸다. 허브 종류(HubKind)는
 *       부모 모듈(LynxUsbDevice의 parentModuleAddress, Control Hub는 173)이면 CONTROL, 아니면 RS-485를 거치는 EXPANSION이다.
 *       비용은 {@link SandbotHardware#beforeInit}부터 {@link SandbotHardware#afterStop}까지만 청구한다
 *       (실제로 구성 읽기·OpMode 사이의 하드웨어 초기화는 팀 코드가 보는 시간 밖이다).</li>
 *   <li>BulkCachingMode: 실제 LynxModule의 recordBulkCachingCommandIntent·getBulkData·clearBulkCache와 같은 규칙.
 *       OFF는 읽기마다 명령, AUTO는 캐시가 없거나 같은 명령(같은 태그 안에서 명령·포트가 같음)을 다시 읽을 때 bulk read,
 *       MANUAL은 clearBulkCache() 뒤 첫 읽기에서 bulk read.</li>
 *   <li>끊긴 스레드: 팀 코드가 도는 동안 끊긴(interrupt) 스레드의 명령은 보내지 않는다({@link #acquireNetworkLock}). 비용
 *       메서드({@link #lynxCommand}·{@link #bulkReadCommand}·{@link #i2cTransaction})가 false를 돌려주면 컨트롤러는 실제
 *       try 블록을 건너뛰는 자리에서 실제 자리값으로 돌아간다(쓰기는 버리고, 읽기는 자리값이며 LastKnown에 넣지 않는다).</li>
 * </ul>
 */
public final class SimHub {
    /** 장치 종류(SimDevice kind). 허브의 SimDevice는 허브 VoltageSensor와 같은 이름(구성의 LynxModule 이름)이다. */
    public static final String KIND = "hub";

    /** 배터리 전압 기본값(V). 입력 voltage가 없으면 이 값이다. */
    public static final double DEFAULT_BATTERY_VOLTS = 12.5;

    private static final Map<LynxModule, SimHub> BY_MODULE = new IdentityHashMap<>();

    /** 비용 청구 여부(beforeInit ~ afterStop) */
    private static volatile boolean charging = false;

    /**
     * STOP을 받은 뒤인가(실제 OpModeManagerImpl.preventDangerousHardwareAccess). 그동안 위험한 명령은 보내지 않는다
     * ({@link #lynxCommand(boolean)}). beforeInit이 끈다.
     */
    private static volatile boolean preventDangerousHardwareAccess = false;

    final String name;
    final int address;
    final boolean parent;
    final HubKind kind;
    final SimDevice device;
    final LynxModule module;
    LynxModuleImuType imuType = LynxModuleImuType.NONE;

    SimDcMotorController motors;
    SimServoController servos;
    SimDigitalChannelController digital;
    SimAnalogInputController analog;

    // BulkCachingMode 상태(실제 LynxModule.bulkCachingMode·bulkCachingHistory·lastBulkData)
    private LynxModule.BulkCachingMode bulkCachingMode = LynxModule.BulkCachingMode.OFF;
    private final Map<String, List<String>> bulkCachingHistory = new HashMap<>();
    private Snapshot lastBulkData;

    SimHub(String name, int address, boolean parent) {
        this.name = name;
        this.address = address;
        this.parent = parent;
        this.kind = parent ? HubKind.CONTROL : HubKind.EXPANSION;
        this.device = Sim.devices().add(name, KIND);
        this.module = new LynxModule(null, address, parent, true);
        synchronized (BY_MODULE) {
            BY_MODULE.put(module, this);
        }
        publishBulkCachingMode();
    }

    /** LynxModule 손 구현이 자기 시뮬레이션 상태를 찾는다. SandbotHardware가 만들지 않은 모듈이면 null. */
    public static SimHub of(LynxModule module) {
        synchronized (BY_MODULE) {
            return BY_MODULE.get(module);
        }
    }

    static void setCharging(boolean value) {
        charging = value;
    }

    static boolean isCharging() {
        return charging;
    }

    static void setPreventDangerousHardwareAccess(boolean value) {
        preventDangerousHardwareAccess = value;
    }

    public String name() {
        return name;
    }

    public int address() {
        return address;
    }

    public boolean isParent() {
        return parent;
    }

    public HubKind kind() {
        return kind;
    }

    public LynxModuleImuType imuType() {
        return imuType;
    }

    // ---------------------------------------------------------------------------------------------
    // 비용
    // ---------------------------------------------------------------------------------------------

    /**
     * 명령을 보내기 전의 네트워크 잠금(실제 LynxRespondable.send·sendReceive → LynxModule.acquireNetworkTransmissionLock →
     * MessageKeyedLock.acquire). 실제 acquire는 acquisitionsLock·lock을 lockInterruptibly로 잡으므로, 끊긴 스레드에서는 잠그기
     * 전에 InterruptedException이 나서 LynxModule.sendCommand까지 가지 않는다. 컨트롤러의 catch → handleException
     * (LynxCommExceptionHandler.handleSpecificException(InterruptedException))은 스레드를 다시 끊고 넘어간다. LinearOpMode는 STOP을
     * 받으면 OpMode 스레드를 끊으므로(internalOnStopRequested) 팀이 끊김을 지우지 않는 한 STOP 뒤의 허브 명령은 모두 이렇다.
     *
     * <p>끊긴 스레드면 잠금 시도 한 번의 비용으로 CLOCK_READ만 청구하고 false다. 그래서 STOP을 무시하고 하드웨어만 부르는 루프도
     * 가상 시간이 흘러 stall이 아니라 stuckInStop으로 끝난다. 끊김 표시는 지우지 않는다: 실제는 lockInterruptibly가 지우고
     * handleException이 다시 세우므로 결과가 같다(그사이 표시를 보는 코드가 없다).
     *
     * <p>팀 코드가 돌지 않을 때(charging이 꺼져 있을 때: 구성 읽기, beforeInit, 런타임의 fail safe인 stopRequested·afterStop)는
     * 보지 않는다. 실제로 그 일은 끊기지 않는 이벤트 루프 스레드가 하므로 막히지 않는다.
     */
    private static boolean acquireNetworkLock() {
        if (!charging || !Thread.currentThread().isInterrupted()) return true;
        Sim.charge(SimCost.CLOCK_READ);
        return false;
    }

    /** 위험하지 않은 Lynx 명령 하나(쓰기, 또는 캐시 없이 읽기). 보냈으면 true. */
    public boolean lynxCommand() {
        return lynxCommand(false);
    }

    /**
     * Lynx 명령 하나. 보냈으면 true(그때만 LYNX_COMMAND 비용을 청구한다). 실제 순서 그대로 먼저 네트워크 잠금
     * ({@link #acquireNetworkLock}: 끊긴 스레드면 false), 다음 LynxModule.sendCommand의 안전 검사다: dangerous(실제
     * LynxMessage.isDangerous가 true: 0이 아닌 모터 power·목표 속도, 목표 위치, 서보 펄스 폭, 서보 PWM 켜기)이고 STOP을 받은
     * 뒤면 보내지 않고 false다. 실제는 CANCELLED_FOR_SAFETY NACK으로 끝내고 컨트롤러의 예외 처리가 그것을 조용히 버린다.
     *
     * <p>취소된 명령도 실제 send·sendReceive가 sendCommand 전에 잡은 네트워크 잠금 한 번의 비용으로 CLOCK_READ를 청구한다(끊긴
     * 스레드의 잠금 시도와 같은 값). 그래서 팀 코드가 끊김을 지운 뒤(8.2 규칙: 위험한 명령은 계속 취소된다) STOP을 무시하고 위험한
     * 명령만 부르는 루프도 가상 시간이 흘러 stuckInStop으로 끝난다(실제는 OpModeStuckCodeMonitor가 잠금을 잡으려는 그 루프를
     * 강제로 멈춘다). 실제는 허브와 주고받지 않으므로 허브 명령 비용은 아니다.
     */
    public boolean lynxCommand(boolean dangerous) {
        if (!acquireNetworkLock()) return false;
        if (dangerous && preventDangerousHardwareAccess) {
            if (charging) Sim.charge(SimCost.CLOCK_READ); // SandBot: 잡은 잠금 한 번(실제 send()의 acquireNetworkLock)
            return false;
        }
        if (charging) Sim.charge(SimCost.LYNX_COMMAND, kind);
        return true;
    }

    /** LynxGetBulkInputDataCommand 하나. 보냈으면 true({@link #acquireNetworkLock}). */
    public boolean bulkReadCommand() {
        if (!acquireNetworkLock()) return false;
        if (charging) Sim.charge(SimCost.BULK_READ, kind);
        return true;
    }

    /** I2C 트랜잭션 하나(이 허브의 I2C 버스). 보냈으면 true({@link #acquireNetworkLock}). */
    public boolean i2cTransaction() {
        if (!acquireNetworkLock()) return false;
        if (charging) Sim.charge(SimCost.I2C_TRANSACTION, kind);
        return true;
    }

    // ---------------------------------------------------------------------------------------------
    // 허브 입력(배터리 전압 등)
    // ---------------------------------------------------------------------------------------------

    public double batteryVolts() {
        return device.inputDouble("voltage", DEFAULT_BATTERY_VOLTS);
    }

    public double input(String key, double fallback) {
        return device.inputDouble(key, fallback);
    }

    // ---------------------------------------------------------------------------------------------
    // Bulk caching
    // ---------------------------------------------------------------------------------------------

    public synchronized LynxModule.BulkCachingMode getBulkCachingMode() {
        return bulkCachingMode;
    }

    /** 실제 setBulkCachingMode: OFF로 바꾸면 캐시를 비운다(MANUAL·AUTO 사이는 캐시를 지킨다) */
    public synchronized void setBulkCachingMode(LynxModule.BulkCachingMode mode) {
        if (mode == LynxModule.BulkCachingMode.OFF) clearBulkCache();
        bulkCachingMode = mode;
        publishBulkCachingMode();
    }

    public synchronized void clearBulkCache() {
        for (List<String> commands : bulkCachingHistory.values()) commands.clear();
        lastBulkData = null;
    }

    /**
     * 실제 getBulkData: 모드와 관계없이 bulk read를 하고 캐시를 새로 채운다. 보내지 못하면(끊긴 스레드) 실제 catch 블록처럼
     * 가짜 값(new BulkData(new LynxGetBulkInputDataResponse(this), true), {@link Snapshot#placeholder})을 lastBulkData로 둔다.
     * 그래서 MANUAL에서는 clearBulkCache까지, AUTO에서는 같은 명령을 다시 읽을 때까지 그 가짜 값이 캐시에서 나온다(실제와 같다).
     */
    public synchronized Snapshot getBulkData() {
        clearBulkCache();
        lastBulkData = bulkReadCommand() ? takeSnapshot() : Snapshot.placeholder();
        return lastBulkData;
    }

    /**
     * 실제 recordBulkCachingCommandIntent(command, tag). command는 명령 종류와 내용(포트)을 합친 글자다
     * (실제는 목적 모듈·명령 번호·내용 바이트를 비교한다). 캐시 모드가 OFF가 아닐 때만 부른다.
     */
    public synchronized Snapshot recordBulkCachingCommandIntent(String command, String tag) {
        List<String> commands = bulkCachingHistory.get(tag);
        if (bulkCachingMode == LynxModule.BulkCachingMode.AUTO) {
            if (commands == null) {
                commands = new ArrayList<>();
                bulkCachingHistory.put(tag, commands);
            }
            if (commands.contains(command)) clearBulkCache();
        }
        if (lastBulkData == null) getBulkData();
        if (bulkCachingMode == LynxModule.BulkCachingMode.AUTO) commands.add(command);
        return lastBulkData;
    }

    public synchronized boolean isBulkCaching() {
        return bulkCachingMode != LynxModule.BulkCachingMode.OFF;
    }

    private void publishBulkCachingMode() {
        device.output("bulkCachingMode", bulkCachingMode.name());
    }

    /** 허브 LED 패턴을 보냈다(LynxModule.setPattern·setConstant). 한 단계 패턴이면 그 색(#RRGGBB), 여러 단계면 "pattern". */
    public void publishLed(List<Blinker.Step> steps) {
        if (steps.isEmpty()) device.output("led", null);
        else if (steps.size() == 1) device.output("led", String.format("#%06X", steps.get(0).getColor() & 0xFFFFFF));
        else device.output("led", "pattern");
    }

    /** bulk read 한 번의 결과(실제 LynxGetBulkInputDataResponse): 엔코더·속도·busy·과전류, 디지털·아날로그 입력 */
    public static final class Snapshot {
        public final int[] motorPositions = new int[4];
        public final int[] motorVelocities = new int[4];
        public final boolean[] motorBusy = new boolean[4];
        public final boolean[] motorOverCurrent = new boolean[4];
        public final boolean[] digitalInputs = new boolean[8];
        public final double[] analogVolts = new double[4];
        /** 보내지 못해 만든 가짜 값인가(실제 BulkData.isFake) */
        public final boolean fake;

        private Snapshot(boolean fake) {
            this.fake = fake;
        }

        /**
         * 실제 getBulkData의 catch 블록이 만드는 가짜 값: 새 LynxGetBulkInputDataResponse의 필드는 모두 0이다(digitalInputs 0,
         * encoders 0, motorStatus 0, velocities 0, analogInputs 0 mV). 그래서 디지털 입력은 false, 엔코더·속도·아날로그는 0,
         * 과전류(motorStatus 비트 0–3)는 false이고, 목표 도달(비트 4–7)도 false라 isMotorBusy(= !isAtTarget)는 모터 넷 모두 true다.
         */
        static Snapshot placeholder() {
            Snapshot s = new Snapshot(true);
            Arrays.fill(s.motorBusy, true);
            return s;
        }
    }

    private Snapshot takeSnapshot() {
        Snapshot s = new Snapshot(false);
        for (int i = 0; i < 4; i++) {
            if (motors != null) {
                s.motorPositions[i] = motors.channel(i).encoderPosition();
                s.motorVelocities[i] = motors.channel(i).encoderVelocity();
                s.motorBusy[i] = motors.channel(i).isBusy();
                s.motorOverCurrent[i] = motors.channel(i).isOverCurrent();
            }
            if (analog != null) s.analogVolts[i] = analog.pinVolts(i);
        }
        for (int i = 0; i < 8; i++) s.digitalInputs[i] = digital != null && digital.pinLevel(i);
        return s;
    }

    // ---------------------------------------------------------------------------------------------
    // Fail safe
    // ---------------------------------------------------------------------------------------------

    /**
     * 실제 LynxModule.failSafe: LynxFailSafeCommand(허브가 모든 모터를 멈추고 끄며 서보 PWM을 끈다) 뒤 컨트롤러의 LastKnown을
     * 잊는다(forgetLastKnown). 펌웨어는 모터 모드·목표 위치를 지우지 않으므로(추론,
     * {@link SimDcMotorController.Channel#targetPositionSet}) STOP 뒤 RUN_TO_POSITION 모터에 setPower(0)을 해도
     * TargetPositionNotSetException이 나지 않는다.
     *
     * <p>보냈으면 true. 팀 코드가 끊긴 스레드에서 부르면 보내지 않고 false다(허브 상태·LastKnown 그대로: 실제 failSafe는
     * command.send()가 던져 forgetLastKnown까지 가지 않는다). 런타임의 fail safe는 charging이 꺼진 채 부르므로 늘 보낸다.
     */
    public boolean failSafe() {
        if (!lynxCommand()) return false; // LynxFailSafeCommand
        if (motors != null) motors.hubFailSafe();
        if (servos != null) servos.hubFailSafe();
        forgetLastKnown();
        return true;
    }

    void forgetLastKnown() {
        if (motors != null) motors.forgetLastKnown();
        if (servos != null) servos.forgetLastKnown();
        if (digital != null) digital.forgetLastKnown();
    }
}
