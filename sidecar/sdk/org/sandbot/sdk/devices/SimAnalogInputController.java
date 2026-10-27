package org.sandbot.sdk.devices;

import com.qualcomm.robotcore.hardware.AnalogInputController;
import com.qualcomm.robotcore.hardware.RobotCoreLynxController;
import com.qualcomm.robotcore.util.SerialNumber;

import org.sandbot.sim.Sim;
import org.sandbot.sim.SimDevice;
import org.sandbot.sim.SimUnsupportedException;

/**
 * 허브의 아날로그 입력 컨트롤러(실제 com.qualcomm.hardware.lynx.LynxAnalogInputController). 읽기는 BulkCachingMode를 따르고,
 * 캐시가 꺼져 있으면 LynxGetADCCommand 하나다. 허브는 mV 정수로 재므로 값은 1 mV 단위다.
 */
public final class SimAnalogInputController implements AnalogInputController, RobotCoreLynxController {
    static final int API_PORT_FIRST = 0;
    static final int API_PORT_LAST = 3;

    public static final String KIND = "analog";

    final SimHub hub;
    private final SimDevice[] devices = new SimDevice[4];

    SimAnalogInputController(SimHub hub) {
        this.hub = hub;
        hub.analog = this;
    }

    SimDevice attach(int port, String name) {
        devices[port] = Sim.devices().add(name, KIND);
        return devices[port];
    }

    /** 핀 전압(V, 0–3.3, 허브 ADC처럼 mV 단위) */
    double pinVolts(int portZ) {
        SimDevice d = devices[portZ];
        double volts = d == null ? 0 : d.inputDouble("voltage", 0);
        volts = Math.max(0, Math.min(getMaxAnalogInputVoltage(), volts));
        return Math.round(volts * 1000) * 0.001;
    }

    @Override public Manufacturer getManufacturer() {
        return Manufacturer.Lynx;
    }

    @Override public String getDeviceName() {
        return "Expansion Hub Analog Input Controller";
    }

    @Override public String getConnectionInfo() {
        return hub.module.getConnectionInfo();
    }

    @Override public int getVersion() {
        return 1;
    }

    @Override public void resetDeviceConfigurationForOpMode() {
    }

    @Override public void close() {
    }

    @Override public SerialNumber getSerialNumber() {
        throw new SimUnsupportedException("com.qualcomm.hardware.lynx.LynxAnalogInputController#getSerialNumber()");
    }

    @Override public double getAnalogInputVoltage(int port) {
        validatePort(port);
        int portZ = port - API_PORT_FIRST;
        if (hub.isBulkCaching()) {
            return hub.recordBulkCachingCommandIntent("getADC:user" + portZ, "").analogVolts[portZ];
        }
        hub.lynxCommand(); // LynxGetADCCommand(user port)
        return pinVolts(portZ);
    }

    @Override public double getMaxAnalogInputVoltage() {
        return 3.3;
    }

    private static void validatePort(int port) {
        if (port < API_PORT_FIRST || port > API_PORT_LAST)
            throw new IllegalArgumentException(String.format("port %d is invalid; valid ports are %d..%d", port, API_PORT_FIRST, API_PORT_LAST));
    }
}
