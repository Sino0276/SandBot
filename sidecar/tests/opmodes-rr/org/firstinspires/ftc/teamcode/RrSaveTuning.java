package org.firstinspires.ftc.teamcode;

import com.acmerobotics.roadrunner.ftc.TuningFiles;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import java.util.LinkedHashMap;
import java.util.Map;

// 램프 로거가 끝날 때처럼 Road Runner TuningFiles.save로 결과를 쓴다(폴더는 사이드카가 실행 전에 만든다)
@TeleOp(name = "RrSaveTuning")
public class RrSaveTuning extends LinearOpMode {
    @Override
    public void runOpMode() {
        waitForStart();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("power", new double[] {0.1, 0.2});
        data.put("voltage", 12.5);
        TuningFiles.INSTANCE.save(TuningFiles.FileType.FORWARD_RAMP, data);
        System.out.println("RESULT saved=true");
    }
}
