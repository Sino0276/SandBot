package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;

// null인 flavor·group·인스턴스(@NonNull이지만 Builder가 받는다)는 그 등록만 버린다. 클래스 등록의 null group은 실제 SDK처럼
// 등록기 안의 NullPointerException이다(뒤의 등록은 없다).
public class NullMetaRegistrar {
    @OpModeRegistrar
    public static void a(OpModeManager manager) {
        manager.register("GoodOne", new FactoryTuner("good"));
        manager.register(new OpModeMeta.Builder().setName("NullGroup").setGroup(null).build(), new FactoryTuner("g"));
        manager.register(new OpModeMeta.Builder().setName("NullFlavor").setFlavor(null).build(), new FactoryTuner("f"));
        manager.register(new OpModeMeta.Builder().setName("NullFlavorClass").setFlavor(null).build(), SplineLike.class);
        manager.register(new OpModeMeta.Builder().setName("NullInstance").build(), (OpMode) null);
        manager.register("AfterNulls", LocalizationLike.class);
    }

    @OpModeRegistrar
    public static void b(OpModeManager manager) {
        manager.register(new OpModeMeta.Builder().setName("NullGroupClass").setGroup(null).build(), SplineLike.class);
        manager.register("NeverReached", new FactoryTuner("never"));
    }
}
