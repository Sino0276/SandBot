package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: 컴파일 오류 → compiled.ok false, 진단(파일·줄·열) */
@TeleOp(name = "Compile Error")
public class CompileError extends LinearOpMode {
    @Override
    public void runOpMode() {
        int x = undefinedVariable;
    }
}
