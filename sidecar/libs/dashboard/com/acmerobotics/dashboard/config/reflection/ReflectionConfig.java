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
// SandBot: FTC Dashboard 0.6.0의 ReflectionConfig(core-0.6.0-sources.jar) 그대로. 객체·배열 필드의 값은 로봇(ART)의 리플렉션
// 접근 규칙으로 읽는다(SandbotFieldAccess: public이 아닌 팀 @Config 클래스의 객체·배열 필드도 트리가 된다).
package com.acmerobotics.dashboard.config.reflection;

import com.acmerobotics.dashboard.config.VariableProvider;
import com.acmerobotics.dashboard.config.variable.BasicVariable;
import com.acmerobotics.dashboard.config.variable.ConfigVariable;
import com.acmerobotics.dashboard.config.variable.CustomVariable;
import com.acmerobotics.dashboard.config.variable.VariableType;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.Arrays;

public class ReflectionConfig {
    private ReflectionConfig() {
    }

    public static CustomVariable createVariableFromClass(Class<?> configClass) {
        CustomVariable customVariable = new CustomVariable();

        for (Field field : configClass.getFields()) {
            if (!Modifier.isStatic(field.getModifiers())
                || Modifier.isFinal(field.getModifiers())) {
                continue;
            }
            customVariable.putVariable(field.getName(), createVariableFromField(field, null));
        }

        return customVariable;
    }

    private static ConfigVariable<?> createVariableFromArrayField(Field field, Class<?> fieldClass,
                                                                  Object parent, int[] indices) {
        VariableType type = VariableType.fromClass(fieldClass);
        switch (type) {
            case BOOLEAN:
            case INT:
            case LONG:
            case FLOAT:
            case DOUBLE:
            case STRING:
            case ENUM:
                return new BasicVariable<>(type, new ArrayProvider<Boolean>(field, parent,
                    Arrays.copyOf(indices, indices.length)));
            case CUSTOM:
                try {
                    Object value = null;
                    try {
                        value = ArrayProvider.getArrayRecursive(SandbotFieldAccess.get(field, parent), indices);
                    } catch (ArrayIndexOutOfBoundsException ignored) {

                    }

                    if (value == null) {
                        return new CustomVariable(null);
                    }
                    CustomVariable customVariable = new CustomVariable();
                    if (fieldClass.isArray()) {
                        int[] newIndices = Arrays.copyOf(indices, indices.length + 1);

                        for (int i = 0; i < Array.getLength(value); i++) {

                            newIndices[newIndices.length - 1] = i;
                            customVariable.putVariable(Integer.toString(i),
                                createVariableFromArrayField(field, fieldClass.getComponentType(),
                                    parent, newIndices));
                        }
                    } else {
                        for (Field nestedField : fieldClass.getFields()) {
                            if (Modifier.isFinal(field.getModifiers())
                                || Modifier.isStatic(field.getModifiers())) {
                                continue;
                            }

                            String name = nestedField.getName();
                            customVariable.putVariable(name,
                                createVariableFromField(nestedField, value));
                        }
                    }
                    return customVariable;
                } catch (IllegalAccessException e) {
                    throw new RuntimeException(e);
                }
            default:
                throw new RuntimeException("Unsupported field type: " +
                    fieldClass.getName());
        }
    }

    private static ConfigVariable<?> createVariableFromField(Field field, Object parent) {
        Class<?> fieldClass = field.getType();
        VariableType type = VariableType.fromClass(fieldClass);
        switch (type) {
            case BOOLEAN:
            case INT:
            case LONG:
            case FLOAT:
            case DOUBLE:
            case STRING:
            case ENUM:
                return new BasicVariable<>(type, new FieldProvider<Boolean>(field, parent));
            case CUSTOM:
                try {
                    Object value = SandbotFieldAccess.get(field, parent);
                    if (value == null) {
                        return new CustomVariable(null);
                    }
                    CustomVariable customVariable = new CustomVariable();
                    if (fieldClass.isArray()) {
                        for (int i = 0; i < Array.getLength(value); i++) {
                            customVariable.putVariable(Integer.toString(i),
                                createVariableFromArrayField(field,
                                    field.getType().getComponentType(), parent, new int[] {i}));
                        }
                    } else {
                        for (Field nestedField : fieldClass.getFields()) {
                            if (Modifier.isFinal(field.getModifiers())
                                || Modifier.isStatic(nestedField.getModifiers())) {
                                continue;
                            }

                            String name = nestedField.getName();
                            customVariable.putVariable(name,
                                createVariableFromField(nestedField, value));
                        }
                    }
                    return customVariable;
                } catch (IllegalAccessException e) {
                    throw new RuntimeException(e);
                }
            default:
                throw new RuntimeException("Unsupported field type: " +
                    fieldClass.getName());
        }
    }
}
