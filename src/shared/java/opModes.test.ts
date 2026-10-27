import { describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../play'
import { compareOpModes, parseOpModes } from './opModes'

const HEADER = 'package org.firstinspires.ftc.teamcode;\n'
const IMPORTS = [
  'import com.qualcomm.robotcore.eventloop.opmode.Autonomous;',
  'import com.qualcomm.robotcore.eventloop.opmode.Disabled;',
  'import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;',
  'import com.qualcomm.robotcore.eventloop.opmode.TeleOp;',
  ''
].join('\n')

function names(text: string): string[] {
  return parseOpModes(text).map((opMode) => opMode.className)
}

describe('parseOpModes', () => {
  it('단일 import의 @TeleOp: 이름·그룹·줄·바이너리 이름', () => {
    const text = `${HEADER}${IMPORTS}
@TeleOp(name = "Drive", group = "Main")
public class Drive extends LinearOpMode {
  @Override public void runOpMode() {}
}
`
    expect(parseOpModes(text)).toEqual([
      {
        className: 'org.firstinspires.ftc.teamcode.Drive',
        line: 7,
        flavor: 'TeleOp',
        name: 'Drive',
        group: 'Main',
        preselectTeleOp: ''
      }
    ])
  })

  it('on-demand import와 전체 이름, 애너테이션 없는 클래스는 뺀다', () => {
    const onDemand = `${HEADER}import com.qualcomm.robotcore.eventloop.opmode.*;
@Autonomous
public class Auto extends LinearOpMode {}
`
    expect(parseOpModes(onDemand)).toMatchObject([
      { className: 'org.firstinspires.ftc.teamcode.Auto', flavor: 'Autonomous', name: 'Auto' }
    ])
    const fqn = `package a.b;
@com.qualcomm.robotcore.eventloop.opmode.TeleOp(group = "x")
public class Full {}
public class NotOne {}
`
    expect(parseOpModes(fqn)).toMatchObject([{ className: 'a.b.Full', group: 'x', line: 2 }])
  })

  it('다른 패키지의 TeleOp·가린 이름·import 없는 단순 이름은 OpMode가 아니다', () => {
    const otherImport = `import org.example.TeleOp;\n@TeleOp public class A {}\n`
    expect(names(otherImport)).toEqual([])
    const noImport = `package x;\n@TeleOp public class B {}\n`
    expect(names(noImport)).toEqual([])
    const shadowed = `import com.qualcomm.robotcore.eventloop.opmode.*;
public class Outer {
  @interface TeleOp {}
  @TeleOp public static class Inner {}
}
`
    expect(names(shadowed)).toEqual([])
    // 단일 import가 on-demand보다 먼저다
    const single = `import com.qualcomm.robotcore.eventloop.opmode.*;
import my.TeleOp;
@TeleOp public class C {}
`
    expect(names(single)).toEqual([])
    // 같은 패키지
    const samePackage = `package com.qualcomm.robotcore.eventloop.opmode;\n@TeleOp public class D {}\n`
    expect(names(samePackage)).toEqual(['com.qualcomm.robotcore.eventloop.opmode.D'])
  })

  it('name·group·preselectTeleOp: 이은 리터럴, 이스케이프, 식이면 기본값, 빈 이름은 단순 이름', () => {
    const text = `${HEADER}${IMPORTS}
@Autonomous(name = "Red " + "Left", group = "A\\tB", preselectTeleOp = "Drive")
public class RedLeft extends LinearOpMode {}

@Autonomous(name = Names.BLUE, group = "G" + 1, preselectTeleOp = PRESELECT)
class Hidden {}
`
    expect(parseOpModes(text)).toMatchObject([
      {
        className: 'org.firstinspires.ftc.teamcode.RedLeft',
        name: 'Red Left',
        group: 'A\tB',
        preselectTeleOp: 'Drive'
      }
    ])
    const nonLiteral = `${IMPORTS}
@Autonomous(name = Names.BLUE, group = "G" + 1, preselectTeleOp = PRESELECT)
public class Blue {}
@TeleOp(name = "   ")
public class Blank {}
@TeleOp(name = "Trailing" +)
public class Broken {}
@TeleOp(name = ("Paren"))
public class Paren {}
`
    expect(
      parseOpModes(nonLiteral).map(({ name, group, preselectTeleOp }) => [
        name,
        group,
        preselectTeleOp
      ])
    ).toEqual([
      ['Blue', '', ''],
      ['Blank', '', ''],
      ['Broken', '', ''],
      ['Paren', '', '']
    ])
  })

  it('TeleOp의 preselectTeleOp는 무시한다(Autonomous만 있다)', () => {
    const text = `${IMPORTS}@TeleOp(preselectTeleOp = "X") public class T {}\n`
    expect(parseOpModes(text)[0].preselectTeleOp).toBe('')
  })

  it('@Disabled·abstract·public 아닌 클래스·inner class·인터페이스·enum·두 애너테이션은 뺀다', () => {
    const text = `${HEADER}${IMPORTS}
import com.qualcomm.robotcore.eventloop.opmode.Utility;
@Disabled @TeleOp public class Off {}
@TeleOp public abstract class Base {}
@TeleOp class PackagePrivate {}
@TeleOp @Autonomous public class Both {}
@TeleOp @Utility public class WithUtility {}
@Utility public class OnlyUtility {}
@TeleOp public interface Iface {}
@TeleOp public enum Mode { A }
public class Outer {
  @TeleOp public class Inner {}
  @TeleOp public static class Nested {}
  @TeleOp static class NotPublic {}
  @Disabled
  @TeleOp public static class NestedOff {}
}
`
    expect(names(text)).toEqual(['org.firstinspires.ftc.teamcode.Outer$Nested'])
  })

  it('중첩 static 클래스는 Outer$Inner, 인터페이스 안 클래스는 늘 public static', () => {
    const text = `${HEADER}${IMPORTS}
public class Outer {
  int field = 3;
  int[] values = { 1, 2 };
  Runnable r = () -> { int x = 1; };
  Object anon = new Object() { @TeleOp class Fake {} };
  static { int y = 0; }
  { int z = 0; }
  public Outer() { super(); }
  <T> void generic(T value) throws Exception { class Local {} }
  public static class Mid {
    @TeleOp(name = "Deep") public static class Deep extends LinearOpMode {}
  }
  public interface Holder {
    @Autonomous class InInterface {}
  }
  @TeleOp public static class Last {}
}
`
    expect(names(text)).toEqual([
      'org.firstinspires.ftc.teamcode.Outer$Mid$Deep',
      'org.firstinspires.ftc.teamcode.Outer$Holder$InInterface',
      'org.firstinspires.ftc.teamcode.Outer$Last'
    ])
  })

  it('한 파일의 여러 클래스, 패키지 없는 파일', () => {
    const text = `${IMPORTS}
@TeleOp public class First {}
@Autonomous public class Second {}
`
    expect(parseOpModes(text).map((opMode) => [opMode.className, opMode.line])).toEqual([
      ['First', 6],
      ['Second', 7]
    ])
  })

  it('주석·문자열 안의 @TeleOp는 애너테이션이 아니다', () => {
    const text = `${HEADER}${IMPORTS}
// @TeleOp public class Commented {}
/* @TeleOp
public class Block {} */
public class Text {
  String s = "@TeleOp public class InString {}";
  char c = '@';
}
`
    expect(names(text)).toEqual([])
  })

  it('리터럴 안의 \\u 이스케이프는 글자로 푼다', () => {
    const text = `${IMPORTS}@TeleOp(name = "\\u00b0 Turn") public class Turn {}\n`
    expect(parseOpModes(text)[0].name).toBe('° Turn')
  })

  it('리터럴 밖의 \\u 이스케이프는 javac처럼 먼저 바꿔 읽고, 줄은 원래 글자의 줄이다', () => {
    // @ = '@'
    const escaped = `${IMPORTS}\\u0040TeleOp(name = "E")\npublic class Escaped {}\n`
    expect(parseOpModes(escaped)).toMatchObject([{ className: 'Escaped', name: 'E', line: 5 }])
    // 주석 안의 \u000a(줄바꿈) 뒤는 javac에게 코드다
    const comment = `${IMPORTS}// note \\u000a @TeleOp public class Revealed {}\n`
    expect(parseOpModes(comment)).toMatchObject([{ className: 'Revealed', line: 5 }])
    // 문자열을 닫는 "(") 때문에 뒤가 코드가 된다
    const quote = `${IMPORTS}class X { String s = "\\u0022; }\n@TeleOp public class AfterQuote {}\n`
    expect(names(quote)).toEqual(['AfterQuote'])
  })

  it('깨진 소스에도 예외를 던지지 않는다', () => {
    for (const text of [
      '',
      '@',
      '@TeleOp(',
      '@TeleOp public class',
      `${IMPORTS}@TeleOp(name = "x) public class A {`,
      'public class A { { { {',
      `${IMPORTS}@TeleOp public class A { public class B { } } } } @TeleOp public class C {}`
    ]) {
      expect(() => parseOpModes(text)).not.toThrow()
    }
  })
})

describe('compareOpModes', () => {
  it('TeleOp → Autonomous, group(기본 먼저) → name → 클래스 이름', () => {
    const make = (
      flavor: OpModeInfo['flavor'],
      group: string,
      name: string,
      className = name
    ): OpModeInfo => ({ className, path: '', line: 1, flavor, name, group, preselectTeleOp: '' })
    const list = [
      make('Autonomous', '', 'A'),
      make('TeleOp', 'b', 'Z'),
      make('TeleOp', '', 'Y'),
      make('TeleOp', 'a', 'X', 'b.X'),
      make('TeleOp', 'a', 'X', 'a.X')
    ]
    expect(
      list.sort(compareOpModes).map((op) => `${op.flavor}/${op.group}/${op.className}`)
    ).toEqual(['TeleOp//Y', 'TeleOp/a/a.X', 'TeleOp/a/b.X', 'TeleOp/b/Z', 'Autonomous//A'])
  })
})
