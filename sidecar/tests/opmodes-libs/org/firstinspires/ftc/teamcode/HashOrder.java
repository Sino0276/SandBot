package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * 사이드카 시험(결정성): 해시 순서 컬렉션의 반복 순서가 실행마다 같은가. enum·Object 키는 identity 해시라 JVM마다 다를 수 있고,
 * Set.of·Map.of는 JDK가 JVM마다 정하는 SALT로 순서를 섞는다. 순서를 "RESULT 이름=…" 줄로 쓴다(두 JVM의 메시지를 바이트로 비교).
 * javac는 -source 8이라 Set.of 등은 쓰지 않고(플랫폼 jar 없이 --release 8로 컴파일) Collectors·HashMap·HashSet만 쓴다.
 */
@Autonomous(name = "Hash Order")
public class HashOrder extends LinearOpMode {
    enum Part {
        ARM, CLAW, LIFT, WRIST, DRIVE, INTAKE, SHOOTER, TURRET, HOOD, FEEDER, CLIMBER, LED, CAMERA, GATE, SPINNER, PUSHER
    }

    static final class Command {
        final int id;

        Command(int id) {
            this.id = id;
        }

        @Override
        public String toString() {
            return "c" + id;
        }
    }

    @Override
    public void runOpMode() {
        // 해시를 더 쓰게 해 JVM마다 다른 순서가 잘 드러나게(시드가 다르면 다른 순서가 될 가능성이 커진다)
        Map<Part, Integer> parts = new HashMap<>();
        for (Part p : Part.values()) parts.put(p, p.ordinal());
        result("enumMap", parts.keySet());

        Set<Command> commands = new HashSet<>();
        for (int i = 0; i < 24; i++) commands.add(new Command(i));
        result("objectSet", commands);

        List<Command> list = new ArrayList<>(commands);
        Set<Command> collected = list.stream().collect(Collectors.toSet());
        result("collectorsToSet", collected);

        Map<Command, Integer> toMap = list.stream().collect(Collectors.toMap(c -> c, c -> c.id));
        result("collectorsToMap", toMap.keySet());

        // 생성자 참조(HashMap::new)와 람다 안의 new HashSet
        Supplier<Map<Part, Set<Command>>> factory = HashMap::new;
        Map<Part, Set<Command>> grouped = factory.get();
        for (Command c : list) grouped.computeIfAbsent(Part.values()[c.id % 16], k -> new HashSet<>()).add(c);
        result("constructorRef", grouped.keySet());
    }

    private void result(String name, Iterable<?> items) {
        StringBuilder out = new StringBuilder();
        for (Object item : items) {
            if (out.length() > 0) out.append(',');
            out.append(item);
        }
        System.out.println("RESULT " + name + "=" + out);
    }
}
