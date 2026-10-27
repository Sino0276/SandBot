package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: 탭으로 들여 쓴 줄의 진단 열은 글자 단위다(javac는 탭을 8칸으로 펼쳐 센다) */
@TeleOp(name = "Tab Compile Error")
public class TabCompileError extends LinearOpMode {
	@Override
	public void runOpMode() {
		String s = "가나"; int x = undefinedVariable;
	}
}
