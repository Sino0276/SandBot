package org.sandbot.sdk.devices;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.hardware.Blinker;
import com.qualcomm.robotcore.hardware.LynxModuleImuType;

import org.sandbot.sim.HubKind;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimCost;
import org.sandbot.sim.SimDevice;

import java.util.ArrayList;
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
     * ({@link #cancelledForSafety}). beforeInit이 끈다.
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

    /**
     * 위험한 명령(실제 LynxMessage.isDangerous가 true: 0이 아닌 모터 power·목표 속도, 목표 위치, 서보 펄스 폭, 서보 PWM 켜기)을
     * 지금 보낼 수 없는가. true면 컨트롤러는 명령을 보내지 않는다(비용·허브 상태 변화 없음). 실제 LynxModule은 STOP 뒤의 위험한
     * 명령을 보내지 않고 CANCELLED_FOR_SAFETY NACK으로 끝내며, 컨트롤러의 예외 처리가 그것을 조용히 버린다.
     */
    boolean cancelledForSafety(boolean dangerous) {
        return dangerous && preventDangerousHardwareAccess;
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

    /** Lynx 명령 하나(쓰기, 또는 캐시 없이 읽기) */
    public void lynxCommand() {
        if (charging) Sim.charge(SimCost.LYNX_COMMAND, kind);
    }

    /** LynxGetBulkInputDataCommand 하나 */
    public void bulkReadCommand() {
        if (charging) Sim.charge(SimCost.BULK_READ, kind);
    }

    /** I2C 트랜잭션 하나(이 허브의 I2C 버스) */
    public void i2cTransaction() {
        if (charging) Sim.charge(SimCost.I2C_TRANSACTION, kind);
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

    /** 실제 getBulkData: 모드와 관계없이 bulk read를 하고 캐시를 새로 채운다 */
    public synchronized Snapshot getBulkData() {
        clearBulkCache();
        bulkReadCommand();
        lastBulkData = takeSnapshot();
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
    }

    private Snapshot takeSnapshot() {
        Snapshot s = new Snapshot();
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
     * 실제 LynxModule.failSafe: LynxFailSafeCommand(허브가 모든 모터를 멈추고 서보 PWM을 끈다) 뒤
     * 컨트롤러의 LastKnown을 잊는다(forgetLastKnown).
     */
    public void failSafe() {
        lynxCommand();
        if (motors != null) motors.hubFailSafe();
        if (servos != null) servos.hubFailSafe();
        forgetLastKnown();
    }

    void forgetLastKnown() {
        if (motors != null) motors.forgetLastKnown();
        if (servos != null) servos.forgetLastKnown();
        if (digital != null) digital.forgetLastKnown();
    }
}
