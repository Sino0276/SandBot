package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import java.io.Serializable;
import java.io.StringReader;
import java.io.BufferedReader;
import java.util.ArrayList;
import java.util.List;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

/**
 * 사이드카 테스트(컴파일 기준): Android 플랫폼 API로 컴파일되는 Java 문법·API. List.of는 Java 9 API라 --release 8에서는
 * 컴파일되지 않고, android-30부터의 플랫폼 jar로는 컴파일된다(Android Studio와 같다). 람다·메서드 참조·직렬화 람다는
 * java.lang.invoke.LambdaMetafactory·SerializedLambda가 필요하다(android.jar에 없어 TeamCompiler가 채운다).
 */
@TeleOp(name = "Platform APIs")
public class PlatformApis extends LinearOpMode {
    @Override
    public void runOpMode() throws InterruptedException {
        List<String> list = List.of("a", "b");
        int base = 3;
        IntSupplier lambda = () -> base + 4;
        Supplier<List<String>> ref = ArrayList::new;
        Runnable serial = (Runnable & Serializable) () -> telemetry.addData("serial", "ran");
        serial.run();
        String firstLine;
        try (BufferedReader reader = new BufferedReader(new StringReader("line one\nline two"))) {
            firstLine = reader.readLine();
        } catch (java.io.IOException e) {
            firstLine = "failed";
        }
        String kind;
        switch (list.get(1)) {
            case "a":
                kind = "first";
                break;
            case "b":
                kind = "second";
                break;
            default:
                kind = "other";
        }
        System.out.println("RESULT list=" + String.join(",", list) + " lambda=" + lambda.getAsInt() + " ref="
                + ref.get().size() + " resource=" + firstLine.replace(' ', '_') + " switch=" + kind);
    }
}
