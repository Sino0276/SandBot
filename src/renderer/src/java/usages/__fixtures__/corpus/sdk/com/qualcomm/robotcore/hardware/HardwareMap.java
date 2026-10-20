package com.qualcomm.robotcore.hardware;

// 사용처 말뭉치를 javac로 컴파일하기 위한 SDK 껍데기(손으로 쓴 시그니처만, 동작 없음)
public class HardwareMap {
    public final DeviceMapping<DcMotor> dcMotor = new DeviceMapping<DcMotor>();
    public final DeviceMapping<Servo> servo = new DeviceMapping<Servo>();

    public <T> T get(Class<? extends T> classOrInterface, String deviceName) {
        return null;
    }

    public <T> T tryGet(Class<? extends T> classOrInterface, String deviceName) {
        return null;
    }

    public static class DeviceMapping<D> {
        public D get(String deviceName) {
            return null;
        }
    }
}
