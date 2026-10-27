package org.sandbot.sdk.devices;

import java.util.HashMap;
import java.util.Map;

/**
 * 실제 SDK가 안드로이드 자원(R.string)에서 읽는 장치 이름 중 장치 애너테이션이 쓰는 것. 값은 FTC SDK 12.0 AAR의
 * res/values/values.xml(RobotCore·Hardware)에서 옮겼다. 실제 ClassUtil.decodeStringRes처럼 "@string/이름"만 바꾼다.
 */
public final class SandbotStrings {
    private static final Map<String, String> STRINGS = new HashMap<>();

    static {
        STRINGS.put("configTypeAnalogInput", "Analog Input");
        STRINGS.put("configTypeContinuousRotationServo", "Continuous Rotation Servo");
        STRINGS.put("configTypeDigitalDevice", "Digital Device");
        STRINGS.put("configTypeLED", "LED");
        STRINGS.put("configTypeMotor", "Motor");
        STRINGS.put("configTypeRevTouchSensor", "REV Touch Sensor");
        STRINGS.put("configTypeServo", "Servo");
        STRINGS.put("configTypeServoFullRange", "Full Range Servo");
        STRINGS.put("configTypeWebcam", "Webcam");
        STRINGS.put("dfrobot_huskylens_name", "HuskyLens");
        STRINGS.put("lynx_embedded_bhi260ap_imu_name", "REV internal IMU (BHI260AP)");
        STRINGS.put("lynx_embedded_bno055_imu_name", "REV internal IMU (BNO055)");
        STRINGS.put("lynx_embedded_imu_description", "an embedded IMU");
        STRINGS.put("rev_20_hd_hex_name", "REV Robotics 20:1 HD Hex Motor");
        STRINGS.put("rev_40_hd_hex_name", "REV Robotics 40:1 HD Hex Motor");
        STRINGS.put("rev_blinkin_description", "a REV Blinkin LED Driver");
        STRINGS.put("rev_blinkin_name", "REV Blinkin LED Driver");
        STRINGS.put("rev_color_sensor_v3_description", "a REV Color Sensor V3");
        STRINGS.put("rev_color_sensor_v3_name", "REV Color Sensor V3");
        STRINGS.put("rev_core_hex_name", "REV Robotics Core Hex Motor");
        STRINGS.put("rev_distributor", "REV Robotics");
        STRINGS.put("rev_laser_sensor_description", "a REV 2M (Time of Flight) Distance Sensor");
        STRINGS.put("rev_laser_sensor_name", "REV 2M Distance Sensor");
        STRINGS.put("rev_spark_mini_description", "a REV SPARKmini Motor Controller");
        STRINGS.put("rev_spark_mini_name", "REV SPARKmini Controller");
        STRINGS.put("rev_touch_sensor_description", "a REV touch sensor");
        STRINGS.put("rev_ultraplanetary_hd_hex_name", "REV Robotics UltraPlanetary HD Hex Motor");
    }

    private SandbotStrings() {}

    /** "@string/이름"이면 그 자원 글자(모르는 이름은 그대로), 아니면 그대로 */
    public static String decodeStringRes(String value) {
        if (value == null || !value.startsWith("@string/")) return value;
        String result = STRINGS.get(value.substring("@string/".length()));
        return result == null ? value : result;
    }
}
