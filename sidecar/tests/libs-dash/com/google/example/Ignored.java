package com.google.example;

import com.acmerobotics.dashboard.config.Config;

/** 라이브러리 L2 시험: 실제 addConfigClasses처럼 이름이 com.google로 시작하는 클래스는 @Config여도 건너뛴다. */
@Config
public class Ignored {
    public static int HIDDEN = 1;
}
