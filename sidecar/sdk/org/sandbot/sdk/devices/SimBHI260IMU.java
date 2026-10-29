package org.sandbot.sdk.devices;

import com.qualcomm.robotcore.hardware.I2cDeviceSynchSimple;

import org.sandbot.sim.SimDevice;

/**
 * Control Hub 내장 BHI260AP(구성 태그 ControlHubImuBHI260AP)의 IMU 드라이버. 동작은 {@link SimImu}와 같고 클래스 이름만 실제
 * 드라이버(com.qualcomm.hardware.bosch.BHI260IMU)처럼 BHI260을 담는다: 실제 HardwareMap.tryGet은 옛 BNO055IMU를 찾지 못했을 때
 * 지도에 클래스 이름이 BHI260인 장치만 있고 BNO055 드라이버가 없으면 IMU 인터페이스로 바꾸라는 경고를 띄운다.
 */
public final class SimBHI260IMU extends SimImu {
    SimBHI260IMU(I2cDeviceSynchSimple deviceClient, SimDevice device) {
        super(deviceClient, Chip.BHI260AP, device);
    }
}
