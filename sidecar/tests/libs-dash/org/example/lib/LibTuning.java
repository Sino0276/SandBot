package org.example.lib;

import com.acmerobotics.dashboard.config.Config;

/** 라이브러리 L2 시험: 라이브러리 jar 안의 @Config 클래스(Road Runner의 Kotlin @JvmField 튜닝 값처럼)도 설정 트리에 들어간다. */
@Config
public class LibTuning {
    public static int RAMP = 4;
}
