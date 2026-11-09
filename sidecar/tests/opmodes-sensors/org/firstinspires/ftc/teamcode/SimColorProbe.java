package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.rev.RevColorSensorV3;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.NormalizedColorSensor;
import com.qualcomm.robotcore.hardware.NormalizedRGBA;

import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

/**
 * 사이드카 센서 시험(sensors.test.ts, 명세 4c C7): 팀 코드처럼 RevColorSensorV3·NormalizedColorSensor를 읽는다(SDK 샘플
 * SensorColor처럼 setGain(2)). 호스트가 보낸 칩 원래 값(red·green·blue·proximity)이 드라이버 값(red × 1.07, blue × 1.55),
 * 정규화 값(× gain / 65535), alpha, getDistance로 어떻게 보이는지 RESULT 줄로 남긴다.
 */
@TeleOp(name = "Sim Color Probe")
public class SimColorProbe extends LinearOpMode {
    @Override
    public void runOpMode() {
        NormalizedColorSensor colorSensor = hardwareMap.get(NormalizedColorSensor.class, "sensor_color");
        RevColorSensorV3 rev = hardwareMap.get(RevColorSensorV3.class, "sensor_color");
        colorSensor.setGain(2);
        waitForStart();
        // LS(25 ms 적분, 100 ms 주기)·PS(100 ms 주기) 측정이 START 뒤 입력으로 끝나게 기다린다
        sleep(300);
        NormalizedRGBA colors = colorSensor.getNormalizedColors();
        double distanceCm = ((DistanceSensor) colorSensor).getDistance(DistanceUnit.CM);
        System.out.println("RESULT red=" + rev.red() + " green=" + rev.green() + " blue=" + rev.blue()
                + " nred=" + colors.red + " ngreen=" + colors.green + " nblue=" + colors.blue
                + " alpha=" + colors.alpha + " distanceCm=" + distanceCm + " raw=" + rev.rawOptical());
    }
}
