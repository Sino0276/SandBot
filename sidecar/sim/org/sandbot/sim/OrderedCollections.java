package org.sandbot.sim;

import java.util.AbstractMap;
import java.util.AbstractSet;
import java.util.Collection;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.BiFunction;
import java.util.function.BinaryOperator;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collector;
import java.util.stream.Collectors;

/**
 * 해시 순서 컬렉션을 만드는 JDK API의 삽입 순서 대리 함수들(결정성). 런타임의 ClassPatcher가 팀 코드·라이브러리·들여온 SDK
 * 클래스의 {@code Set.of}·{@code Map.of}·{@code Map.ofEntries}·{@code Set.copyOf}·{@code Map.copyOf}·{@code Collectors.toSet}·
 * {@code toMap}·{@code toUnmodifiableSet}·{@code toUnmodifiableMap}·{@code groupingBy}·{@code HashMap.newHashMap}·
 * {@code HashSet.newHashSet} 호출을 이 클래스의 같은 서술자 정적 메서드로 바꾼다(대응 표는 ClassPatcher.TARGETS). {@code new HashMap}·
 * {@code new HashSet}은 패처가 {@code LinkedHashMap}·{@code LinkedHashSet}으로 바꾼다.
 *
 * <p>왜: enum·Object 키의 해시는 identity 해시라 JVM마다 다르고(HotSpot은 스레드마다 시드를 정하는데 JIT 스레드 수가 실행마다
 * 다르다), JDK의 Set.of·Map.of는 JVM마다 정하는 SALT로 반복 순서를 섞는다. 그 순서가 하드웨어 호출 순서를 정하면(FTCLib
 * ParallelCommandGroup, Ivy parallel) 같은 입력에서 다른 프로토콜 메시지가 나온다.
 *
 * <p>규칙: 결과의 반복 순서는 넣은(만난) 순서다. 그 밖의 뜻은 실행 중인 JDK(17+)와 같다: null이면 NullPointerException,
 * 중복이면 같은 예외 형식과 메시지(IllegalArgumentException "duplicate element: e"·"duplicate key: k",
 * IllegalStateException "Duplicate key k (attempted merging values u and v)"), 불변 결과를 바꾸려 하면
 * UnsupportedOperationException, 불변 Set·Map의 contains(null)·containsKey(null)·containsValue(null)·get(null)은
 * NullPointerException. 다른 것: 직렬화 형식(JDK의 CollSer가 아님)과 NullPointerException의 메시지(JDK의 암시적 NPE 안내문 대신 없음).
 * 이 클래스는 패치하지 않는다(org.sandbot.sim).
 */
public final class OrderedCollections {
    private OrderedCollections() {}

    // ---- Set.of ----

    public static <E> Set<E> setOf() {
        return new ImmutableSet<>(new LinkedHashSet<E>());
    }

    public static <E> Set<E> setOf(E e1) {
        return setOfArray(e1);
    }

    public static <E> Set<E> setOf(E e1, E e2) {
        return setOfArray(e1, e2);
    }

    public static <E> Set<E> setOf(E e1, E e2, E e3) {
        return setOfArray(e1, e2, e3);
    }

    public static <E> Set<E> setOf(E e1, E e2, E e3, E e4) {
        return setOfArray(e1, e2, e3, e4);
    }

    public static <E> Set<E> setOf(E e1, E e2, E e3, E e4, E e5) {
        return setOfArray(e1, e2, e3, e4, e5);
    }

    public static <E> Set<E> setOf(E e1, E e2, E e3, E e4, E e5, E e6) {
        return setOfArray(e1, e2, e3, e4, e5, e6);
    }

    public static <E> Set<E> setOf(E e1, E e2, E e3, E e4, E e5, E e6, E e7) {
        return setOfArray(e1, e2, e3, e4, e5, e6, e7);
    }

    public static <E> Set<E> setOf(E e1, E e2, E e3, E e4, E e5, E e6, E e7, E e8) {
        return setOfArray(e1, e2, e3, e4, e5, e6, e7, e8);
    }

    public static <E> Set<E> setOf(E e1, E e2, E e3, E e4, E e5, E e6, E e7, E e8, E e9) {
        return setOfArray(e1, e2, e3, e4, e5, e6, e7, e8, e9);
    }

    public static <E> Set<E> setOf(E e1, E e2, E e3, E e4, E e5, E e6, E e7, E e8, E e9, E e10) {
        return setOfArray(e1, e2, e3, e4, e5, e6, e7, e8, e9, e10);
    }

    /** Set.of(E...): 배열을 그대로 읽는다(JDK처럼 배열이 null이면 NPE) */
    @SafeVarargs
    public static <E> Set<E> setOf(E... elements) {
        return setOfArray(elements);
    }

    @SafeVarargs
    private static <E> Set<E> setOfArray(E... elements) {
        LinkedHashSet<E> set = new LinkedHashSet<>(capacity(elements.length));
        for (E e : elements) {
            if (!set.add(Objects.requireNonNull(e))) throw new IllegalArgumentException("duplicate element: " + e);
        }
        return new ImmutableSet<>(set);
    }

    /** Set.copyOf(Collection): 중복은 하나로(만난 순서), null이면 NPE */
    @SuppressWarnings("unchecked")
    public static <E> Set<E> setCopyOf(Collection<? extends E> collection) {
        if (collection instanceof ImmutableSet) return (Set<E>) collection;
        LinkedHashSet<E> set = new LinkedHashSet<>(capacity(collection.size()));
        for (E e : collection) set.add(Objects.requireNonNull(e));
        return new ImmutableSet<>(set);
    }

    // ---- Map.of ----

    public static <K, V> Map<K, V> mapOf() {
        return new ImmutableMap<>(new LinkedHashMap<K, V>());
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1) {
        return mapOfPairs(k1, v1);
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1, K k2, V v2) {
        return mapOfPairs(k1, v1, k2, v2);
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1, K k2, V v2, K k3, V v3) {
        return mapOfPairs(k1, v1, k2, v2, k3, v3);
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1, K k2, V v2, K k3, V v3, K k4, V v4) {
        return mapOfPairs(k1, v1, k2, v2, k3, v3, k4, v4);
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1, K k2, V v2, K k3, V v3, K k4, V v4, K k5, V v5) {
        return mapOfPairs(k1, v1, k2, v2, k3, v3, k4, v4, k5, v5);
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1, K k2, V v2, K k3, V v3, K k4, V v4, K k5, V v5, K k6, V v6) {
        return mapOfPairs(k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6);
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1, K k2, V v2, K k3, V v3, K k4, V v4, K k5, V v5, K k6, V v6, K k7,
            V v7) {
        return mapOfPairs(k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6, k7, v7);
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1, K k2, V v2, K k3, V v3, K k4, V v4, K k5, V v5, K k6, V v6, K k7,
            V v7, K k8, V v8) {
        return mapOfPairs(k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6, k7, v7, k8, v8);
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1, K k2, V v2, K k3, V v3, K k4, V v4, K k5, V v5, K k6, V v6, K k7,
            V v7, K k8, V v8, K k9, V v9) {
        return mapOfPairs(k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6, k7, v7, k8, v8, k9, v9);
    }

    public static <K, V> Map<K, V> mapOf(K k1, V v1, K k2, V v2, K k3, V v3, K k4, V v4, K k5, V v5, K k6, V v6, K k7,
            V v7, K k8, V v8, K k9, V v9, K k10, V v10) {
        return mapOfPairs(k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6, k7, v7, k8, v8, k9, v9, k10, v10);
    }

    @SuppressWarnings("unchecked")
    private static <K, V> Map<K, V> mapOfPairs(Object... pairs) {
        LinkedHashMap<K, V> map = new LinkedHashMap<>(capacity(pairs.length / 2));
        for (int i = 0; i < pairs.length; i += 2) put(map, (K) pairs[i], (V) pairs[i + 1]);
        return new ImmutableMap<>(map);
    }

    private static <K, V> void put(LinkedHashMap<K, V> map, K key, V value) {
        Objects.requireNonNull(key);
        Objects.requireNonNull(value);
        if (map.putIfAbsent(key, value) != null) throw new IllegalArgumentException("duplicate key: " + key);
    }

    /** Map.ofEntries(Entry...) */
    @SafeVarargs
    public static <K, V> Map<K, V> mapOfEntries(Map.Entry<? extends K, ? extends V>... entries) {
        LinkedHashMap<K, V> map = new LinkedHashMap<>(capacity(entries.length));
        for (Map.Entry<? extends K, ? extends V> e : entries) put(map, e.getKey(), e.getValue());
        return new ImmutableMap<>(map);
    }

    /** Map.copyOf(Map): 원본의 반복 순서, null 키·값이면 NPE */
    @SuppressWarnings("unchecked")
    public static <K, V> Map<K, V> mapCopyOf(Map<? extends K, ? extends V> source) {
        if (source instanceof ImmutableMap) return (Map<K, V>) source;
        LinkedHashMap<K, V> map = new LinkedHashMap<>(capacity(source.size()));
        for (Map.Entry<? extends K, ? extends V> e : source.entrySet()) put(map, e.getKey(), e.getValue());
        return new ImmutableMap<>(map);
    }

    // ---- HashMap.newHashMap·HashSet.newHashSet(JDK 19+) ----

    public static <K, V> java.util.HashMap<K, V> newHashMap(int numMappings) {
        if (numMappings < 0) throw new IllegalArgumentException("Negative number of mappings: " + numMappings);
        return new LinkedHashMap<>(capacity(numMappings));
    }

    public static <T> java.util.HashSet<T> newHashSet(int numElements) {
        if (numElements < 0) throw new IllegalArgumentException("Negative number of elements: " + numElements);
        return new LinkedHashSet<>(capacity(numElements));
    }

    // ---- Collectors ----

    /** Collectors.toSet(): LinkedHashSet(만난 순서). JDK의 UNORDERED는 두지 않는다(병렬로 합쳐도 순서를 지키게) */
    public static <T> Collector<T, ?, Set<T>> toSet() {
        return Collector.<T, Set<T>>of(LinkedHashSet::new, Set::add, (left, right) -> {
            left.addAll(right);
            return left;
        });
    }

    /** Collectors.toMap(k, v): 키가 겹치면 IllegalStateException, 값이 null이면 NPE(JDK 9+와 같은 문장) */
    public static <T, K, U> Collector<T, ?, Map<K, U>> toMap(Function<? super T, ? extends K> keyMapper,
            Function<? super T, ? extends U> valueMapper) {
        return Collector.<T, Map<K, U>>of(LinkedHashMap::new, (map, element) -> {
            K k = keyMapper.apply(element);
            U v = Objects.requireNonNull(valueMapper.apply(element));
            U u = map.putIfAbsent(k, v);
            if (u != null) throw duplicateKey(k, u, v);
        }, (left, right) -> {
            for (Map.Entry<K, U> e : right.entrySet()) {
                K k = e.getKey();
                U v = Objects.requireNonNull(e.getValue());
                U u = left.putIfAbsent(k, v);
                if (u != null) throw duplicateKey(k, u, v);
            }
            return left;
        });
    }

    /** Collectors.toMap(k, v, merge): JDK의 toMap(k, v, merge, HashMap::new)를 LinkedHashMap으로 */
    public static <T, K, U> Collector<T, ?, Map<K, U>> toMap(Function<? super T, ? extends K> keyMapper,
            Function<? super T, ? extends U> valueMapper, BinaryOperator<U> mergeFunction) {
        return Collectors.toMap(keyMapper, valueMapper, mergeFunction, LinkedHashMap::new);
    }

    /** Collectors.toUnmodifiableSet() */
    public static <T> Collector<T, ?, Set<T>> toUnmodifiableSet() {
        return Collector.<T, LinkedHashSet<T>, Set<T>>of(LinkedHashSet::new, Set::add, (left, right) -> {
            left.addAll(right);
            return left;
        }, OrderedCollections::copyChecked);
    }

    /** Collectors.toUnmodifiableMap(k, v) */
    public static <T, K, U> Collector<T, ?, Map<K, U>> toUnmodifiableMap(Function<? super T, ? extends K> keyMapper,
            Function<? super T, ? extends U> valueMapper) {
        Objects.requireNonNull(keyMapper, "keyMapper");
        Objects.requireNonNull(valueMapper, "valueMapper");
        return Collectors.collectingAndThen(toMap(keyMapper, valueMapper), OrderedCollections::mapCopyOf);
    }

    /** Collectors.toUnmodifiableMap(k, v, merge) */
    public static <T, K, U> Collector<T, ?, Map<K, U>> toUnmodifiableMap(Function<? super T, ? extends K> keyMapper,
            Function<? super T, ? extends U> valueMapper, BinaryOperator<U> mergeFunction) {
        Objects.requireNonNull(keyMapper, "keyMapper");
        Objects.requireNonNull(valueMapper, "valueMapper");
        Objects.requireNonNull(mergeFunction, "mergeFunction");
        return Collectors.collectingAndThen(Collectors.toMap(keyMapper, valueMapper, mergeFunction, LinkedHashMap::new),
                OrderedCollections::mapCopyOf);
    }

    /** Collectors.groupingBy(f): JDK의 groupingBy(f, HashMap::new, toList())를 LinkedHashMap으로 */
    public static <T, K> Collector<T, ?, Map<K, List<T>>> groupingBy(Function<? super T, ? extends K> classifier) {
        return Collectors.groupingBy(classifier, LinkedHashMap::new, Collectors.<T>toList());
    }

    /** Collectors.groupingBy(f, downstream) */
    public static <T, K, A, D> Collector<T, ?, Map<K, D>> groupingBy(Function<? super T, ? extends K> classifier,
            Collector<? super T, A, D> downstream) {
        return Collectors.groupingBy(classifier, LinkedHashMap::new, downstream);
    }

    private static IllegalStateException duplicateKey(Object k, Object u, Object v) {
        return new IllegalStateException(String.format("Duplicate key %s (attempted merging values %s and %s)", k, u, v));
    }

    /** null 원소가 있으면 NPE(JDK의 Set.of(set.toArray())와 같음), 아니면 순서를 지킨 불변 사본 */
    private static <T> Set<T> copyChecked(LinkedHashSet<T> set) {
        for (T e : set) Objects.requireNonNull(e);
        return new ImmutableSet<>(set);
    }

    /** HashMap의 기본 부하율로 n개를 다시 해시하지 않고 담는 크기 */
    private static int capacity(int n) {
        return n < 3 ? n + 1 : (int) Math.min(1 << 30, (long) Math.ceil(n / 0.75));
    }

    private static UnsupportedOperationException immutable() {
        return new UnsupportedOperationException();
    }

    // ---- 불변 컬렉션(JDK ImmutableCollections처럼: 바꾸는 메서드는 늘 UOE, null 질의는 NPE) ----

    static final class ImmutableSet<E> extends AbstractSet<E> implements java.io.Serializable {
        private static final long serialVersionUID = 1L;
        private final LinkedHashSet<E> elements;

        ImmutableSet(LinkedHashSet<E> elements) {
            this.elements = elements;
        }

        @Override public Iterator<E> iterator() {
            return new ReadOnlyIterator<>(elements.iterator());
        }

        @Override public int size() {
            return elements.size();
        }

        @Override public boolean contains(Object o) {
            return elements.contains(Objects.requireNonNull(o));
        }

        @Override public boolean add(E e) {
            throw immutable();
        }

        @Override public boolean addAll(Collection<? extends E> c) {
            throw immutable();
        }

        @Override public boolean remove(Object o) {
            throw immutable();
        }

        @Override public boolean removeAll(Collection<?> c) {
            throw immutable();
        }

        @Override public boolean retainAll(Collection<?> c) {
            throw immutable();
        }

        @Override public boolean removeIf(Predicate<? super E> filter) {
            throw immutable();
        }

        @Override public void clear() {
            throw immutable();
        }
    }

    /**
     * keySet·values는 AbstractMap 것(entrySet 위의 보기)을 쓴다: JDK처럼 그 remove는 반복자의 remove("remove")로,
     * clear는 이 맵의 clear(UOE)로 간다.
     */
    static final class ImmutableMap<K, V> extends AbstractMap<K, V> implements java.io.Serializable {
        private static final long serialVersionUID = 1L;
        private final LinkedHashMap<K, V> map;
        private transient Set<Map.Entry<K, V>> entries;

        ImmutableMap(LinkedHashMap<K, V> map) {
            this.map = map;
        }

        @Override public Set<Map.Entry<K, V>> entrySet() {
            if (entries == null) {
                entries = new AbstractSet<Map.Entry<K, V>>() {
                    @Override public Iterator<Map.Entry<K, V>> iterator() {
                        Iterator<Map.Entry<K, V>> it = map.entrySet().iterator();
                        return new Iterator<Map.Entry<K, V>>() {
                            @Override public boolean hasNext() {
                                return it.hasNext();
                            }

                            @Override public Map.Entry<K, V> next() {
                                return new ImmutableEntry<>(it.next());
                            }
                        };
                    }

                    @Override public int size() {
                        return map.size();
                    }
                };
            }
            return entries;
        }

        @Override public int size() {
            return map.size();
        }

        @Override public V get(Object key) {
            return map.get(Objects.requireNonNull(key));
        }

        @Override public V getOrDefault(Object key, V defaultValue) {
            V v = map.get(Objects.requireNonNull(key));
            return v != null ? v : defaultValue;
        }

        @Override public boolean containsKey(Object key) {
            return map.containsKey(Objects.requireNonNull(key));
        }

        @Override public boolean containsValue(Object value) {
            return map.containsValue(Objects.requireNonNull(value));
        }

        @Override public V put(K key, V value) {
            throw immutable();
        }

        @Override public void putAll(Map<? extends K, ? extends V> m) {
            throw immutable();
        }

        @Override public V remove(Object key) {
            throw immutable();
        }

        @Override public boolean remove(Object key, Object value) {
            throw immutable();
        }

        @Override public void clear() {
            throw immutable();
        }

        @Override public V putIfAbsent(K key, V value) {
            throw immutable();
        }

        @Override public boolean replace(K key, V oldValue, V newValue) {
            throw immutable();
        }

        @Override public V replace(K key, V value) {
            throw immutable();
        }

        @Override public void replaceAll(BiFunction<? super K, ? super V, ? extends V> function) {
            throw immutable();
        }

        @Override public V computeIfAbsent(K key, Function<? super K, ? extends V> mappingFunction) {
            throw immutable();
        }

        @Override public V computeIfPresent(K key, BiFunction<? super K, ? super V, ? extends V> remappingFunction) {
            throw immutable();
        }

        @Override public V compute(K key, BiFunction<? super K, ? super V, ? extends V> remappingFunction) {
            throw immutable();
        }

        @Override public V merge(K key, V value, BiFunction<? super V, ? super V, ? extends V> remappingFunction) {
            throw immutable();
        }
    }

    /** 반복자(remove는 Iterator의 기본처럼 UnsupportedOperationException("remove"), JDK의 불변 컬렉션과 같다) */
    private static final class ReadOnlyIterator<E> implements Iterator<E> {
        private final Iterator<E> it;

        ReadOnlyIterator(Iterator<E> it) {
            this.it = it;
        }

        @Override public boolean hasNext() {
            return it.hasNext();
        }

        @Override public E next() {
            return it.next();
        }
    }

    /** 불변 맵의 항목(JDK KeyValueHolder처럼 setValue는 UnsupportedOperationException("not supported")) */
    private static final class ImmutableEntry<K, V> extends AbstractMap.SimpleImmutableEntry<K, V> {
        private static final long serialVersionUID = 1L;

        ImmutableEntry(Map.Entry<K, V> e) {
            super(e.getKey(), e.getValue());
        }

        @Override public V setValue(V value) {
            throw new UnsupportedOperationException("not supported");
        }
    }
}
