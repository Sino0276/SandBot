/* MIT License

Copyright (c) 2018-2022 ACME Robotics

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE. */
// SandBot: FTC Dashboard 0.6.0의 FieldProvider(core-0.6.0-sources.jar) 그대로. 필드는 로봇(ART)의 리플렉션 접근 규칙으로 읽고
// 쓴다(SandbotFieldAccess: public이 아닌 팀 클래스의 public 필드도 읽고 쓰고, final 쓰기만 거부).
package com.acmerobotics.dashboard.config.reflection;

import com.acmerobotics.dashboard.config.ValueProvider;
import java.lang.reflect.Field;

/**
 * Value provider backed by a class field.
 *
 * @param <T> type of the class field
 */
public class FieldProvider<T> implements ValueProvider<T> {
    private final Field field;
    private final Object parent;

    public FieldProvider(Field field, Object parent) {
        this.field = field;
        this.parent = parent;
    }

    @SuppressWarnings("unchecked")
    @Override
    public T get() {
        try {
            return (T) SandbotFieldAccess.get(field, parent);
        } catch (IllegalAccessException e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public void set(T value) {
        try {
            SandbotFieldAccess.set(field, parent, value);
        } catch (IllegalAccessException e) {
            throw new RuntimeException(e);
        }
    }
}
