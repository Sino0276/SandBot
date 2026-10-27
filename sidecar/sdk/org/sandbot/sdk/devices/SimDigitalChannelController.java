package org.sandbot.sdk.devices;

import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.DigitalChannelController;
import com.qualcomm.robotcore.hardware.RobotCoreLynxController;
import com.qualcomm.robotcore.util.SerialNumber;

import org.sandbot.sim.Sim;
import org.sandbot.sim.SimDevice;
import org.sandbot.sim.SimUnsupportedException;

/**
 * 허브의 디지털 채널 컨트롤러(실제 com.qualcomm.hardware.lynx.LynxDigitalChannelController를 옮긴 것).
 *
 * <p>입력 핀은 풀업이라 아무것도 연결되지 않으면 true(HIGH)를 읽는다. 터치 센서처럼 눌렀을 때 LOW가 되는 장치는
 * 입력 pressed로 핀 값을 정한다. 입력 모드의 상태 읽기는 BulkCachingMode를 따른다. 출력 모드의 상태 읽기는 SDK가
 * 마지막으로 쓴 값을 돌려준다(허브에 묻지 않음, 실제와 같음).
 */
public final class SimDigitalChannelController implements DigitalChannelController, RobotCoreLynxController {
    static final int API_PIN_FIRST = 0;
    static final int API_PIN_LAST = 7;

    public static final String KIND_DIGITAL = "digital";
    public static final String KIND_TOUCH = "touch";
    public static final String KIND_LED = "led";

    final SimHub hub;

    private static final class PinProperties {
        final SimLastKnown<DigitalChannel.Mode> lastKnownMode = new SimLastKnown<>();
        final SimLastKnown<Boolean> lastKnownState = new SimLastKnown<>();
    }

    /** 펌웨어 쪽 핀 상태 */
    static final class Pin {
        SimDevice device;
        String kind;
        DigitalChannel.Mode mode = DigitalChannel.Mode.INPUT;
        boolean outputState = false;

        /** 핀의 전기적 값(입력이면 장치·풀업, 출력이면 쓴 값) */
        boolean level() {
            if (mode == DigitalChannel.Mode.OUTPUT) return outputState;
            if (device == null) return true;
            if (KIND_TOUCH.equals(kind)) return !device.inputBoolean("pressed", false);
            return device.inputBoolean("state", true);
        }

        void publish() {
            if (device == null) return;
            if (KIND_LED.equals(kind)) {
                // LED는 LOW에서 켜진다(실제 LED.enable: 핀 상태 = !enable)
                device.output("on", mode == DigitalChannel.Mode.OUTPUT ? (Object) !outputState : null);
                return;
            }
            device.output("mode", mode.name());
            device.output("state", mode == DigitalChannel.Mode.OUTPUT ? (Object) outputState : null);
        }
    }

    private final PinProperties[] pins = new PinProperties[8];
    private final Pin[] hardware = new Pin[8];

    SimDigitalChannelController(SimHub hub) {
        this.hub = hub;
        hub.digital = this;
        for (int i = 0; i < 8; i++) {
            pins[i] = new PinProperties();
            hardware[i] = new Pin();
        }
    }

    SimDevice attach(int pin, String name, String kind) {
        Pin p = hardware[pin];
        p.kind = kind;
        p.device = Sim.devices().add(name, kind);
        p.publish();
        return p.device;
    }

    boolean pinLevel(int pinZ) {
        return hardware[pinZ].level();
    }

    /** LynxDigitalChannelController.initializeHardware: 모든 핀을 입력으로 */
    void initializeHardware() {
        forgetLastKnown();
        for (int pin = API_PIN_FIRST; pin <= API_PIN_LAST; pin++) internalSetDigitalChannelMode(pin - API_PIN_FIRST, DigitalChannel.Mode.INPUT);
    }

    void forgetLastKnown() {
        for (PinProperties pin : pins) {
            pin.lastKnownMode.invalidate();
            pin.lastKnownState.invalidate();
        }
    }

    @Override public Manufacturer getManufacturer() {
        return Manufacturer.Lynx;
    }

    @Override public String getDeviceName() {
        return "Expansion Hub Digital Channel Controller";
    }

    @Override public String getConnectionInfo() {
        return hub.module.getConnectionInfo();
    }

    @Override public int getVersion() {
        return 1;
    }

    @Override public void resetDeviceConfigurationForOpMode() {
        initializeHardware();
    }

    @Override public void close() {
    }

    /** 허브 일련번호(SerialNumber)는 이 시뮬레이터에서 만들 수 없다 */
    @Override public SerialNumber getSerialNumber() {
        throw new SimUnsupportedException("com.qualcomm.hardware.lynx.LynxDigitalChannelController#getSerialNumber()");
    }

    @Override public synchronized DigitalChannel.Mode getDigitalChannelMode(int pin) {
        validatePin(pin);
        int pinZ = pin - API_PIN_FIRST;
        DigitalChannel.Mode result = pins[pinZ].lastKnownMode.getValue();
        if (result != null) return result;
        hub.lynxCommand(); // LynxGetDIODirectionCommand
        result = hardware[pinZ].mode;
        pins[pinZ].lastKnownMode.setValue(result);
        return result;
    }

    @Override public synchronized void setDigitalChannelMode(int pin, DigitalChannel.Mode mode) {
        DigitalChannel.Mode existingMode = getDigitalChannelMode(pin);
        validatePin(pin);
        int pinZ = pin - API_PIN_FIRST;
        internalSetDigitalChannelMode(pinZ, mode);
        if (existingMode == DigitalChannel.Mode.INPUT && mode == DigitalChannel.Mode.OUTPUT) {
            pins[pinZ].lastKnownState.setValue(false);
        }
    }

    @Deprecated
    @Override public void setDigitalChannelMode(int pin, DigitalChannelController.Mode mode) {
        // 실제는 mode.migrate(): INPUT·OUTPUT 이름이 같다
        setDigitalChannelMode(pin, DigitalChannel.Mode.valueOf(mode.name()));
    }

    private void internalSetDigitalChannelMode(int pinZ, DigitalChannel.Mode mode) {
        hub.lynxCommand(); // LynxSetDIODirectionCommand
        Pin p = hardware[pinZ];
        if (p.mode == DigitalChannel.Mode.INPUT && mode == DigitalChannel.Mode.OUTPUT) p.outputState = false;
        p.mode = mode;
        pins[pinZ].lastKnownMode.setValue(mode);
        p.publish();
    }

    @Override public synchronized boolean getDigitalChannelState(int pin) {
        DigitalChannel.Mode mode = getDigitalChannelMode(pin);
        validatePin(pin);
        int pinZ = pin - API_PIN_FIRST;
        if (mode == DigitalChannel.Mode.OUTPUT) {
            // 실제와 같이 언박싱한다(값을 잊은 뒤면 NullPointerException)
            return pins[pinZ].lastKnownState.getNonTimedValue();
        }
        if (hub.isBulkCaching()) {
            return hub.recordBulkCachingCommandIntent("getSingleDIOInput:" + pinZ, "").digitalInputs[pinZ];
        }
        hub.lynxCommand(); // LynxGetSingleDIOInputCommand
        boolean result = hardware[pinZ].level();
        pins[pinZ].lastKnownState.setValue(result);
        return result;
    }

    @Override public synchronized void setDigitalChannelState(int pin, boolean state) {
        DigitalChannel.Mode mode = getDigitalChannelMode(pin);
        validatePin(pin);
        int pinZ = pin - API_PIN_FIRST;
        if (mode == DigitalChannel.Mode.OUTPUT) {
            hub.lynxCommand(); // LynxSetSingleDIOOutputCommand
            hardware[pinZ].outputState = state;
            hardware[pinZ].publish();
            pins[pinZ].lastKnownState.setValue(state);
        }
    }

    private static void validatePin(int pin) {
        if (pin < API_PIN_FIRST || pin > API_PIN_LAST)
            throw new IllegalArgumentException(String.format("pin %d is invalid; valid pins are %d..%d", pin, API_PIN_FIRST, API_PIN_LAST));
    }
}
