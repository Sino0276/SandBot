package org.json;

// SandBot: Android 플랫폼의 org.json(API 19) 중 FTC SDK(Limelight 결과 해석)와 팀 코드가 흔히 쓰는 부분을 새로 쓴 것.
// 동작(opt 기본값, 형 변환, 오류)은 Android 문서의 의미를 따른다.
public class JSONException extends Exception {
    public JSONException(String s) {
        super(s);
    }
}
