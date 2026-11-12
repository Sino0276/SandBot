package org.sandbot.sdk.devices;

import com.qualcomm.robotcore.hardware.RobotCoreLynxController;
import com.qualcomm.robotcore.hardware.VoltageSensor;

/**
 * 허브의 배터리 전압 센서(실제 com.qualcomm.hardware.lynx.LynxVoltageSensor). 읽을 때마다 LynxGetADCCommand(BATTERY_MONITOR)
 * 하나이고 bulk read로 대신하지 않는다. 값은 허브 SimDevice의 입력 voltage(V, 기본 {@link SimHub#DEFAULT_BATTERY_VOLTS}).
 */
public final class SimVoltageSensor implements VoltageSensor, RobotCoreLynxController {
    final SimHub hub;

    SimVoltageSensor(SimHub hub) {
        this.hub = hub;
    }

    @Override public double getVoltage() {
        if (!hub.lynxCommand()) return 0.0; // LynxGetADCCommand(BATTERY_MONITOR). 끊김: 실제 자리값 0.0
        int mv = (int) Math.round(hub.batteryVolts() * 1000);
        return mv * 0.001;
    }

    @Override public Manufacturer getManufacturer() {
        return Manufacturer.Lynx;
    }

    @Override public String getDeviceName() {
        return "Expansion Hub Voltage Sensor";
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
}
