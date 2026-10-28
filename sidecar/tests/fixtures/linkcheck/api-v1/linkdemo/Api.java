package linkdemo;

/** 링크 검사 시험: 사용자(User)는 이 판(v1)에 대고 컴파일하고, jar에는 gone()이 없는 v2가 들어간다 */
public class Api {
    public static int gone() {
        return 0;
    }

    public static int kept() {
        return 1;
    }
}
