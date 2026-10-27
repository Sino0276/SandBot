package org.sandbot.fixture;

import org.sandbot.sim.SimUnsupportedException;
import org.sandbot.testing.Check;

/** support.ts의 compileJavaTests·runJavaTests 확인용(build.test.ts): 하나는 통과, 하나는 실패한다. */
public final class SampleTests {
    public static void testPasses() {
        Check.equal("SandBot simulator does not support a#b() yet", new SimUnsupportedException("a#b()").getMessage(),
                "message");
    }

    public static void testFails() {
        Check.equal(1, 2, "deliberate failure");
    }

    // test로 시작하지 않으므로 돌지 않는다
    public static void helper() {
        throw new AssertionError("must not run");
    }
}
