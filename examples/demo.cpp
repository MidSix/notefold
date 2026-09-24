#include <cstdio>
#include <vector>

// @note-start id=c9v1re color=purple
// ## Suma de prefijos
// `prefix[i]` guarda la suma de `v[0..i)`, así cualquier suma de rango
// se calcula en O(1):
//
// ```cpp
// sum(l, r) = prefix[r] - prefix[l];
// ```
// @note-body-end
std::vector<long long> build_prefix(const std::vector<int>& v) {
    std::vector<long long> prefix(v.size() + 1, 0);
    for (size_t i = 0; i < v.size(); ++i) prefix[i + 1] = prefix[i] + v[i];
    return prefix;
}
// @note-end

int main() {
    std::vector<int> v{3, 1, 4, 1, 5};
    auto p = build_prefix(v);
        // @note-start id=q0w8ns color=yellow
        // Indentación distinta: el parser la tolera.
        // @note-body-end
    std::printf("%lld\n", p[4] - p[1]);
    // @note-end
    return 0;
}
