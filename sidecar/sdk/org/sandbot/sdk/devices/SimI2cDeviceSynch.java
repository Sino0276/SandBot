package org.sandbot.sdk.devices;

import com.qualcomm.robotcore.hardware.I2cAddr;
import com.qualcomm.robotcore.hardware.I2cDeviceSynch;
import com.qualcomm.robotcore.hardware.I2cWaitControl;
import com.qualcomm.robotcore.hardware.TimestampedData;

import org.sandbot.sim.Sim;

/**
 * 허브 I2C 버스의 장치 하나에 대한 연결(실제 LynxI2cDeviceSynch, 생성자가 I2cDeviceSynch를 받는 드라이버는
 * I2cDeviceSynchImplOnSimple로 감싼 것). read·write 호출 한 번이 I2C 트랜잭션 하나다(읽기 창·쓰기 합치기는 쓰지 않는다:
 * 카탈로그의 드라이버는 읽기 창을 정하지 않는다).
 */
final class SimI2cDeviceSynch implements I2cDeviceSynch {
    private final SimHub hub;
    private final int bus;
    private final SimI2cChip chip;
    private I2cAddr i2cAddr;
    private String userConfiguredName;
    private boolean engaged = true;
    private boolean writeCoalescing = false;
    private boolean logging = false;
    private String loggingTag = "I2C";
    private HealthStatus healthStatus = HealthStatus.HEALTHY;
    private ReadWindow readWindow;
    private int heartbeatInterval = 0;
    private HeartbeatAction heartbeatAction;

    SimI2cDeviceSynch(SimHub hub, int bus, I2cAddr address, String name, SimI2cChip chip) {
        this.hub = hub;
        this.bus = bus;
        this.i2cAddr = address;
        this.userConfiguredName = name;
        this.chip = chip;
    }

    // ---- 읽기 ----

    @Override public byte read8() {
        return read(1)[0];
    }

    @Override public byte read8(int ireg) {
        return read(ireg, 1)[0];
    }

    @Override public synchronized byte[] read(int creg) {
        hub.i2cTransaction();
        return chip.read(SimI2cChip.NO_REGISTER, creg);
    }

    @Override public synchronized byte[] read(int ireg, int creg) {
        hub.i2cTransaction();
        return chip.read(ireg, creg);
    }

    @Override public TimestampedData readTimeStamped(int creg) {
        return stamp(read(creg));
    }

    @Override public TimestampedData readTimeStamped(int ireg, int creg) {
        return stamp(read(ireg, creg));
    }

    @Override public TimestampedData readTimeStamped(int ireg, int creg, ReadWindow readWindowNeeded, ReadWindow readWindowSet) {
        return readTimeStamped(ireg, creg);
    }

    private static TimestampedData stamp(byte[] data) {
        TimestampedData result = new TimestampedData();
        result.data = data;
        result.nanoTime = Sim.installed() ? Sim.nanoTime() : 0;
        return result;
    }

    // ---- 쓰기 ----

    @Override public void write8(int bVal) {
        write(new byte[] {(byte) bVal});
    }

    @Override public void write8(int ireg, int bVal) {
        write(ireg, new byte[] {(byte) bVal});
    }

    @Override public synchronized void write(byte[] data) {
        hub.i2cTransaction();
        chip.write(SimI2cChip.NO_REGISTER, data.clone());
    }

    @Override public synchronized void write(int ireg, byte[] data) {
        hub.i2cTransaction();
        chip.write(ireg, data.clone());
    }

    @Override public void write8(int bVal, I2cWaitControl waitControl) {
        write8(bVal);
    }

    @Override public void write8(int ireg, int bVal, I2cWaitControl waitControl) {
        write8(ireg, bVal);
    }

    @Override public void write(byte[] data, I2cWaitControl waitControl) {
        write(data);
    }

    @Override public void write(int ireg, byte[] data, I2cWaitControl waitControl) {
        write(ireg, data);
    }

    @Override public void waitForWriteCompletions(I2cWaitControl waitControl) {
    }

    @Override public void enableWriteCoalescing(boolean enable) {
        writeCoalescing = enable;
    }

    @Override public boolean isWriteCoalescingEnabled() {
        return writeCoalescing;
    }

    // ---- 상태 ----

    @Override public boolean isArmed() {
        return true;
    }

    @Override @Deprecated public void setI2cAddr(I2cAddr i2cAddr) {
        setI2cAddress(i2cAddr);
    }

    @Override @Deprecated public I2cAddr getI2cAddr() {
        return getI2cAddress();
    }

    @Override public void setI2cAddress(I2cAddr newAddress) {
        this.i2cAddr = newAddress;
    }

    @Override public I2cAddr getI2cAddress() {
        return i2cAddr;
    }

    @Override public void setLogging(boolean enabled) {
        logging = enabled;
    }

    @Override public boolean getLogging() {
        return logging;
    }

    @Override public void setLoggingTag(String loggingTag) {
        this.loggingTag = loggingTag;
    }

    @Override public String getLoggingTag() {
        return loggingTag;
    }

    @Override public void setUserConfiguredName(String name) {
        this.userConfiguredName = name;
    }

    @Override public String getUserConfiguredName() {
        return userConfiguredName;
    }

    @Override public void setHealthStatus(HealthStatus status) {
        healthStatus = status;
    }

    @Override public HealthStatus getHealthStatus() {
        return healthStatus;
    }

    @Override public void setReadWindow(ReadWindow window) {
        readWindow = window;
    }

    @Override public ReadWindow getReadWindow() {
        return readWindow;
    }

    @Override public void ensureReadWindow(ReadWindow windowNeeded, ReadWindow windowToSet) {
        if (readWindow == null || !readWindow.containsWithSameMode(windowNeeded)) readWindow = windowToSet;
    }

    @Override public void setHeartbeatInterval(int ms) {
        heartbeatInterval = Math.max(0, ms);
    }

    @Override public int getHeartbeatInterval() {
        return heartbeatInterval;
    }

    @Override public void setHeartbeatAction(HeartbeatAction action) {
        heartbeatAction = action;
    }

    @Override public HeartbeatAction getHeartbeatAction() {
        return heartbeatAction;
    }

    @Override public void engage() {
        engaged = true;
    }

    @Override public void disengage() {
        engaged = false;
    }

    @Override public boolean isEngaged() {
        return engaged;
    }

    // ---- HardwareDevice ----

    @Override public Manufacturer getManufacturer() {
        return Manufacturer.Lynx;
    }

    @Override public String getDeviceName() {
        return "Expansion Hub I2C Device";
    }

    /** 실제 LynxI2cDeviceSynch.getConnectionInfo와 같은 모양 */
    @Override public String getConnectionInfo() {
        return String.format("%s; bus %d; addr7=0x%02x", hub.module.getConnectionInfo(), bus, i2cAddr.get7Bit());
    }

    @Override public int getVersion() {
        return 1;
    }

    @Override public void resetDeviceConfigurationForOpMode() {
        readWindow = null;
    }

    @Override public void close() {
        healthStatus = HealthStatus.CLOSED;
    }
}
