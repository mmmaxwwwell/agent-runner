"use strict";
(() => {
  // node_modules/preact/dist/preact.module.js
  var n;
  var l;
  var u;
  var t;
  var i;
  var r;
  var o;
  var e;
  var f;
  var c;
  var s;
  var a;
  var h;
  var p = {};
  var v = [];
  var y = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
  var d = Array.isArray;
  function w(n2, l3) {
    for (var u4 in l3) n2[u4] = l3[u4];
    return n2;
  }
  function g(n2) {
    n2 && n2.parentNode && n2.parentNode.removeChild(n2);
  }
  function _(l3, u4, t3) {
    var i3, r3, o3, e3 = {};
    for (o3 in u4) "key" == o3 ? i3 = u4[o3] : "ref" == o3 ? r3 = u4[o3] : e3[o3] = u4[o3];
    if (arguments.length > 2 && (e3.children = arguments.length > 3 ? n.call(arguments, 2) : t3), "function" == typeof l3 && null != l3.defaultProps) for (o3 in l3.defaultProps) void 0 === e3[o3] && (e3[o3] = l3.defaultProps[o3]);
    return m(l3, e3, i3, r3, null);
  }
  function m(n2, t3, i3, r3, o3) {
    var e3 = { type: n2, props: t3, key: i3, ref: r3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == o3 ? ++u : o3, __i: -1, __u: 0 };
    return null == o3 && null != l.vnode && l.vnode(e3), e3;
  }
  function k(n2) {
    return n2.children;
  }
  function x(n2, l3) {
    this.props = n2, this.context = l3;
  }
  function S(n2, l3) {
    if (null == l3) return n2.__ ? S(n2.__, n2.__i + 1) : null;
    for (var u4; l3 < n2.__k.length; l3++) if (null != (u4 = n2.__k[l3]) && null != u4.__e) return u4.__e;
    return "function" == typeof n2.type ? S(n2) : null;
  }
  function C(n2) {
    if (n2.__P && n2.__d) {
      var u4 = n2.__v, t3 = u4.__e, i3 = [], r3 = [], o3 = w({}, u4);
      o3.__v = u4.__v + 1, l.vnode && l.vnode(o3), z(n2.__P, o3, u4, n2.__n, n2.__P.namespaceURI, 32 & u4.__u ? [t3] : null, i3, null == t3 ? S(u4) : t3, !!(32 & u4.__u), r3), o3.__v = u4.__v, o3.__.__k[o3.__i] = o3, V(i3, o3, r3), u4.__e = u4.__ = null, o3.__e != t3 && M(o3);
    }
  }
  function M(n2) {
    if (null != (n2 = n2.__) && null != n2.__c) return n2.__e = n2.__c.base = null, n2.__k.some(function(l3) {
      if (null != l3 && null != l3.__e) return n2.__e = n2.__c.base = l3.__e;
    }), M(n2);
  }
  function $(n2) {
    (!n2.__d && (n2.__d = true) && i.push(n2) && !I.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(I);
  }
  function I() {
    try {
      for (var n2, l3 = 1; i.length; ) i.length > l3 && i.sort(e), n2 = i.shift(), l3 = i.length, C(n2);
    } finally {
      i.length = I.__r = 0;
    }
  }
  function P(n2, l3, u4, t3, i3, r3, o3, e3, f4, c3, s3) {
    var a3, h3, y3, d3, w3, g2, _2, m3 = t3 && t3.__k || v, b = l3.length;
    for (f4 = A(u4, l3, m3, f4, b), a3 = 0; a3 < b; a3++) null != (y3 = u4.__k[a3]) && (h3 = -1 != y3.__i && m3[y3.__i] || p, y3.__i = a3, g2 = z(n2, y3, h3, i3, r3, o3, e3, f4, c3, s3), d3 = y3.__e, y3.ref && h3.ref != y3.ref && (h3.ref && D(h3.ref, null, y3), s3.push(y3.ref, y3.__c || d3, y3)), null == w3 && null != d3 && (w3 = d3), (_2 = !!(4 & y3.__u)) || h3.__k === y3.__k ? f4 = H(y3, f4, n2, _2) : "function" == typeof y3.type && void 0 !== g2 ? f4 = g2 : d3 && (f4 = d3.nextSibling), y3.__u &= -7);
    return u4.__e = w3, f4;
  }
  function A(n2, l3, u4, t3, i3) {
    var r3, o3, e3, f4, c3, s3 = u4.length, a3 = s3, h3 = 0;
    for (n2.__k = new Array(i3), r3 = 0; r3 < i3; r3++) null != (o3 = l3[r3]) && "boolean" != typeof o3 && "function" != typeof o3 ? ("string" == typeof o3 || "number" == typeof o3 || "bigint" == typeof o3 || o3.constructor == String ? o3 = n2.__k[r3] = m(null, o3, null, null, null) : d(o3) ? o3 = n2.__k[r3] = m(k, { children: o3 }, null, null, null) : void 0 === o3.constructor && o3.__b > 0 ? o3 = n2.__k[r3] = m(o3.type, o3.props, o3.key, o3.ref ? o3.ref : null, o3.__v) : n2.__k[r3] = o3, f4 = r3 + h3, o3.__ = n2, o3.__b = n2.__b + 1, e3 = null, -1 != (c3 = o3.__i = T(o3, u4, f4, a3)) && (a3--, (e3 = u4[c3]) && (e3.__u |= 2)), null == e3 || null == e3.__v ? (-1 == c3 && (i3 > s3 ? h3-- : i3 < s3 && h3++), "function" != typeof o3.type && (o3.__u |= 4)) : c3 != f4 && (c3 == f4 - 1 ? h3-- : c3 == f4 + 1 ? h3++ : (c3 > f4 ? h3-- : h3++, o3.__u |= 4))) : n2.__k[r3] = null;
    if (a3) for (r3 = 0; r3 < s3; r3++) null != (e3 = u4[r3]) && 0 == (2 & e3.__u) && (e3.__e == t3 && (t3 = S(e3)), E(e3, e3));
    return t3;
  }
  function H(n2, l3, u4, t3) {
    var i3, r3;
    if ("function" == typeof n2.type) {
      for (i3 = n2.__k, r3 = 0; i3 && r3 < i3.length; r3++) i3[r3] && (i3[r3].__ = n2, l3 = H(i3[r3], l3, u4, t3));
      return l3;
    }
    n2.__e != l3 && (t3 && (l3 && n2.type && !l3.parentNode && (l3 = S(n2)), u4.insertBefore(n2.__e, l3 || null)), l3 = n2.__e);
    do {
      l3 = l3 && l3.nextSibling;
    } while (null != l3 && 8 == l3.nodeType);
    return l3;
  }
  function T(n2, l3, u4, t3) {
    var i3, r3, o3, e3 = n2.key, f4 = n2.type, c3 = l3[u4], s3 = null != c3 && 0 == (2 & c3.__u);
    if (null === c3 && null == e3 || s3 && e3 == c3.key && f4 == c3.type) return u4;
    if (t3 > (s3 ? 1 : 0)) {
      for (i3 = u4 - 1, r3 = u4 + 1; i3 >= 0 || r3 < l3.length; ) if (null != (c3 = l3[o3 = i3 >= 0 ? i3-- : r3++]) && 0 == (2 & c3.__u) && e3 == c3.key && f4 == c3.type) return o3;
    }
    return -1;
  }
  function j(n2, l3, u4) {
    "-" == l3[0] ? n2.setProperty(l3, null == u4 ? "" : u4) : n2[l3] = null == u4 ? "" : "number" != typeof u4 || y.test(l3) ? u4 : u4 + "px";
  }
  function F(n2, l3, u4, t3, i3) {
    var r3, o3;
    n: if ("style" == l3) if ("string" == typeof u4) n2.style.cssText = u4;
    else {
      if ("string" == typeof t3 && (n2.style.cssText = t3 = ""), t3) for (l3 in t3) u4 && l3 in u4 || j(n2.style, l3, "");
      if (u4) for (l3 in u4) t3 && u4[l3] == t3[l3] || j(n2.style, l3, u4[l3]);
    }
    else if ("o" == l3[0] && "n" == l3[1]) r3 = l3 != (l3 = l3.replace(f, "$1")), o3 = l3.toLowerCase(), l3 = o3 in n2 || "onFocusOut" == l3 || "onFocusIn" == l3 ? o3.slice(2) : l3.slice(2), n2.l || (n2.l = {}), n2.l[l3 + r3] = u4, u4 ? t3 ? u4.u = t3.u : (u4.u = c, n2.addEventListener(l3, r3 ? a : s, r3)) : n2.removeEventListener(l3, r3 ? a : s, r3);
    else {
      if ("http://www.w3.org/2000/svg" == i3) l3 = l3.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if ("width" != l3 && "height" != l3 && "href" != l3 && "list" != l3 && "form" != l3 && "tabIndex" != l3 && "download" != l3 && "rowSpan" != l3 && "colSpan" != l3 && "role" != l3 && "popover" != l3 && l3 in n2) try {
        n2[l3] = null == u4 ? "" : u4;
        break n;
      } catch (n3) {
      }
      "function" == typeof u4 || (null == u4 || false === u4 && "-" != l3[4] ? n2.removeAttribute(l3) : n2.setAttribute(l3, "popover" == l3 && 1 == u4 ? "" : u4));
    }
  }
  function O(n2) {
    return function(u4) {
      if (this.l) {
        var t3 = this.l[u4.type + n2];
        if (null == u4.t) u4.t = c++;
        else if (u4.t < t3.u) return;
        return t3(l.event ? l.event(u4) : u4);
      }
    };
  }
  function z(n2, u4, t3, i3, r3, o3, e3, f4, c3, s3) {
    var a3, h3, p3, y3, _2, m3, b, S2, C3, M2, $2, I2, A3, H2, L, T3 = u4.type;
    if (void 0 !== u4.constructor) return null;
    128 & t3.__u && (c3 = !!(32 & t3.__u), o3 = [f4 = u4.__e = t3.__e]), (a3 = l.__b) && a3(u4);
    n: if ("function" == typeof T3) try {
      if (S2 = u4.props, C3 = T3.prototype && T3.prototype.render, M2 = (a3 = T3.contextType) && i3[a3.__c], $2 = a3 ? M2 ? M2.props.value : a3.__ : i3, t3.__c ? b = (h3 = u4.__c = t3.__c).__ = h3.__E : (C3 ? u4.__c = h3 = new T3(S2, $2) : (u4.__c = h3 = new x(S2, $2), h3.constructor = T3, h3.render = G), M2 && M2.sub(h3), h3.state || (h3.state = {}), h3.__n = i3, p3 = h3.__d = true, h3.__h = [], h3._sb = []), C3 && null == h3.__s && (h3.__s = h3.state), C3 && null != T3.getDerivedStateFromProps && (h3.__s == h3.state && (h3.__s = w({}, h3.__s)), w(h3.__s, T3.getDerivedStateFromProps(S2, h3.__s))), y3 = h3.props, _2 = h3.state, h3.__v = u4, p3) C3 && null == T3.getDerivedStateFromProps && null != h3.componentWillMount && h3.componentWillMount(), C3 && null != h3.componentDidMount && h3.__h.push(h3.componentDidMount);
      else {
        if (C3 && null == T3.getDerivedStateFromProps && S2 !== y3 && null != h3.componentWillReceiveProps && h3.componentWillReceiveProps(S2, $2), u4.__v == t3.__v || !h3.__e && null != h3.shouldComponentUpdate && false === h3.shouldComponentUpdate(S2, h3.__s, $2)) {
          u4.__v != t3.__v && (h3.props = S2, h3.state = h3.__s, h3.__d = false), u4.__e = t3.__e, u4.__k = t3.__k, u4.__k.some(function(n3) {
            n3 && (n3.__ = u4);
          }), v.push.apply(h3.__h, h3._sb), h3._sb = [], h3.__h.length && e3.push(h3);
          break n;
        }
        null != h3.componentWillUpdate && h3.componentWillUpdate(S2, h3.__s, $2), C3 && null != h3.componentDidUpdate && h3.__h.push(function() {
          h3.componentDidUpdate(y3, _2, m3);
        });
      }
      if (h3.context = $2, h3.props = S2, h3.__P = n2, h3.__e = false, I2 = l.__r, A3 = 0, C3) h3.state = h3.__s, h3.__d = false, I2 && I2(u4), a3 = h3.render(h3.props, h3.state, h3.context), v.push.apply(h3.__h, h3._sb), h3._sb = [];
      else do {
        h3.__d = false, I2 && I2(u4), a3 = h3.render(h3.props, h3.state, h3.context), h3.state = h3.__s;
      } while (h3.__d && ++A3 < 25);
      h3.state = h3.__s, null != h3.getChildContext && (i3 = w(w({}, i3), h3.getChildContext())), C3 && !p3 && null != h3.getSnapshotBeforeUpdate && (m3 = h3.getSnapshotBeforeUpdate(y3, _2)), H2 = null != a3 && a3.type === k && null == a3.key ? q(a3.props.children) : a3, f4 = P(n2, d(H2) ? H2 : [H2], u4, t3, i3, r3, o3, e3, f4, c3, s3), h3.base = u4.__e, u4.__u &= -161, h3.__h.length && e3.push(h3), b && (h3.__E = h3.__ = null);
    } catch (n3) {
      if (u4.__v = null, c3 || null != o3) if (n3.then) {
        for (u4.__u |= c3 ? 160 : 128; f4 && 8 == f4.nodeType && f4.nextSibling; ) f4 = f4.nextSibling;
        o3[o3.indexOf(f4)] = null, u4.__e = f4;
      } else {
        for (L = o3.length; L--; ) g(o3[L]);
        N(u4);
      }
      else u4.__e = t3.__e, u4.__k = t3.__k, n3.then || N(u4);
      l.__e(n3, u4, t3);
    }
    else null == o3 && u4.__v == t3.__v ? (u4.__k = t3.__k, u4.__e = t3.__e) : f4 = u4.__e = B(t3.__e, u4, t3, i3, r3, o3, e3, c3, s3);
    return (a3 = l.diffed) && a3(u4), 128 & u4.__u ? void 0 : f4;
  }
  function N(n2) {
    n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(N));
  }
  function V(n2, u4, t3) {
    for (var i3 = 0; i3 < t3.length; i3++) D(t3[i3], t3[++i3], t3[++i3]);
    l.__c && l.__c(u4, n2), n2.some(function(u5) {
      try {
        n2 = u5.__h, u5.__h = [], n2.some(function(n3) {
          n3.call(u5);
        });
      } catch (n3) {
        l.__e(n3, u5.__v);
      }
    });
  }
  function q(n2) {
    return "object" != typeof n2 || null == n2 || n2.__b > 0 ? n2 : d(n2) ? n2.map(q) : w({}, n2);
  }
  function B(u4, t3, i3, r3, o3, e3, f4, c3, s3) {
    var a3, h3, v3, y3, w3, _2, m3, b = i3.props || p, k3 = t3.props, x2 = t3.type;
    if ("svg" == x2 ? o3 = "http://www.w3.org/2000/svg" : "math" == x2 ? o3 = "http://www.w3.org/1998/Math/MathML" : o3 || (o3 = "http://www.w3.org/1999/xhtml"), null != e3) {
      for (a3 = 0; a3 < e3.length; a3++) if ((w3 = e3[a3]) && "setAttribute" in w3 == !!x2 && (x2 ? w3.localName == x2 : 3 == w3.nodeType)) {
        u4 = w3, e3[a3] = null;
        break;
      }
    }
    if (null == u4) {
      if (null == x2) return document.createTextNode(k3);
      u4 = document.createElementNS(o3, x2, k3.is && k3), c3 && (l.__m && l.__m(t3, e3), c3 = false), e3 = null;
    }
    if (null == x2) b === k3 || c3 && u4.data == k3 || (u4.data = k3);
    else {
      if (e3 = e3 && n.call(u4.childNodes), !c3 && null != e3) for (b = {}, a3 = 0; a3 < u4.attributes.length; a3++) b[(w3 = u4.attributes[a3]).name] = w3.value;
      for (a3 in b) w3 = b[a3], "dangerouslySetInnerHTML" == a3 ? v3 = w3 : "children" == a3 || a3 in k3 || "value" == a3 && "defaultValue" in k3 || "checked" == a3 && "defaultChecked" in k3 || F(u4, a3, null, w3, o3);
      for (a3 in k3) w3 = k3[a3], "children" == a3 ? y3 = w3 : "dangerouslySetInnerHTML" == a3 ? h3 = w3 : "value" == a3 ? _2 = w3 : "checked" == a3 ? m3 = w3 : c3 && "function" != typeof w3 || b[a3] === w3 || F(u4, a3, w3, b[a3], o3);
      if (h3) c3 || v3 && (h3.__html == v3.__html || h3.__html == u4.innerHTML) || (u4.innerHTML = h3.__html), t3.__k = [];
      else if (v3 && (u4.innerHTML = ""), P("template" == t3.type ? u4.content : u4, d(y3) ? y3 : [y3], t3, i3, r3, "foreignObject" == x2 ? "http://www.w3.org/1999/xhtml" : o3, e3, f4, e3 ? e3[0] : i3.__k && S(i3, 0), c3, s3), null != e3) for (a3 = e3.length; a3--; ) g(e3[a3]);
      c3 || (a3 = "value", "progress" == x2 && null == _2 ? u4.removeAttribute("value") : null != _2 && (_2 !== u4[a3] || "progress" == x2 && !_2 || "option" == x2 && _2 != b[a3]) && F(u4, a3, _2, b[a3], o3), a3 = "checked", null != m3 && m3 != u4[a3] && F(u4, a3, m3, b[a3], o3));
    }
    return u4;
  }
  function D(n2, u4, t3) {
    try {
      if ("function" == typeof n2) {
        var i3 = "function" == typeof n2.__u;
        i3 && n2.__u(), i3 && null == u4 || (n2.__u = n2(u4));
      } else n2.current = u4;
    } catch (n3) {
      l.__e(n3, t3);
    }
  }
  function E(n2, u4, t3) {
    var i3, r3;
    if (l.unmount && l.unmount(n2), (i3 = n2.ref) && (i3.current && i3.current != n2.__e || D(i3, null, u4)), null != (i3 = n2.__c)) {
      if (i3.componentWillUnmount) try {
        i3.componentWillUnmount();
      } catch (n3) {
        l.__e(n3, u4);
      }
      i3.base = i3.__P = null;
    }
    if (i3 = n2.__k) for (r3 = 0; r3 < i3.length; r3++) i3[r3] && E(i3[r3], u4, t3 || "function" != typeof n2.type);
    t3 || g(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
  }
  function G(n2, l3, u4) {
    return this.constructor(n2, u4);
  }
  function J(u4, t3, i3) {
    var r3, o3, e3, f4;
    t3 == document && (t3 = document.documentElement), l.__ && l.__(u4, t3), o3 = (r3 = "function" == typeof i3) ? null : i3 && i3.__k || t3.__k, e3 = [], f4 = [], z(t3, u4 = (!r3 && i3 || t3).__k = _(k, null, [u4]), o3 || p, p, t3.namespaceURI, !r3 && i3 ? [i3] : o3 ? null : t3.firstChild ? n.call(t3.childNodes) : null, e3, !r3 && i3 ? i3 : o3 ? o3.__e : t3.firstChild, r3, f4), V(e3, u4, f4);
  }
  n = v.slice, l = { __e: function(n2, l3, u4, t3) {
    for (var i3, r3, o3; l3 = l3.__; ) if ((i3 = l3.__c) && !i3.__) try {
      if ((r3 = i3.constructor) && null != r3.getDerivedStateFromError && (i3.setState(r3.getDerivedStateFromError(n2)), o3 = i3.__d), null != i3.componentDidCatch && (i3.componentDidCatch(n2, t3 || {}), o3 = i3.__d), o3) return i3.__E = i3;
    } catch (l4) {
      n2 = l4;
    }
    throw n2;
  } }, u = 0, t = function(n2) {
    return null != n2 && void 0 === n2.constructor;
  }, x.prototype.setState = function(n2, l3) {
    var u4;
    u4 = null != this.__s && this.__s != this.state ? this.__s : this.__s = w({}, this.state), "function" == typeof n2 && (n2 = n2(w({}, u4), this.props)), n2 && w(u4, n2), null != n2 && this.__v && (l3 && this._sb.push(l3), $(this));
  }, x.prototype.forceUpdate = function(n2) {
    this.__v && (this.__e = true, n2 && this.__h.push(n2), $(this));
  }, x.prototype.render = k, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l3) {
    return n2.__v.__b - l3.__v.__b;
  }, I.__r = 0, f = /(PointerCapture)$|Capture$/i, c = 0, s = O(false), a = O(true), h = 0;

  // node_modules/preact/hooks/dist/hooks.module.js
  var t2;
  var r2;
  var u2;
  var i2;
  var o2 = 0;
  var f2 = [];
  var c2 = l;
  var e2 = c2.__b;
  var a2 = c2.__r;
  var v2 = c2.diffed;
  var l2 = c2.__c;
  var m2 = c2.unmount;
  var s2 = c2.__;
  function p2(n2, t3) {
    c2.__h && c2.__h(r2, n2, o2 || t3), o2 = 0;
    var u4 = r2.__H || (r2.__H = { __: [], __h: [] });
    return n2 >= u4.__.length && u4.__.push({}), u4.__[n2];
  }
  function d2(n2) {
    return o2 = 1, h2(D2, n2);
  }
  function h2(n2, u4, i3) {
    var o3 = p2(t2++, 2);
    if (o3.t = n2, !o3.__c && (o3.__ = [i3 ? i3(u4) : D2(void 0, u4), function(n3) {
      var t3 = o3.__N ? o3.__N[0] : o3.__[0], r3 = o3.t(t3, n3);
      t3 !== r3 && (o3.__N = [r3, o3.__[1]], o3.__c.setState({}));
    }], o3.__c = r2, !r2.__f)) {
      var f4 = function(n3, t3, r3) {
        if (!o3.__c.__H) return true;
        var u5 = o3.__c.__H.__.filter(function(n4) {
          return n4.__c;
        });
        if (u5.every(function(n4) {
          return !n4.__N;
        })) return !c3 || c3.call(this, n3, t3, r3);
        var i4 = o3.__c.props !== n3;
        return u5.some(function(n4) {
          if (n4.__N) {
            var t4 = n4.__[0];
            n4.__ = n4.__N, n4.__N = void 0, t4 !== n4.__[0] && (i4 = true);
          }
        }), c3 && c3.call(this, n3, t3, r3) || i4;
      };
      r2.__f = true;
      var c3 = r2.shouldComponentUpdate, e3 = r2.componentWillUpdate;
      r2.componentWillUpdate = function(n3, t3, r3) {
        if (this.__e) {
          var u5 = c3;
          c3 = void 0, f4(n3, t3, r3), c3 = u5;
        }
        e3 && e3.call(this, n3, t3, r3);
      }, r2.shouldComponentUpdate = f4;
    }
    return o3.__N || o3.__;
  }
  function y2(n2, u4) {
    var i3 = p2(t2++, 3);
    !c2.__s && C2(i3.__H, u4) && (i3.__ = n2, i3.u = u4, r2.__H.__h.push(i3));
  }
  function A2(n2) {
    return o2 = 5, T2(function() {
      return { current: n2 };
    }, []);
  }
  function T2(n2, r3) {
    var u4 = p2(t2++, 7);
    return C2(u4.__H, r3) && (u4.__ = n2(), u4.__H = r3, u4.__h = n2), u4.__;
  }
  function q2(n2, t3) {
    return o2 = 8, T2(function() {
      return n2;
    }, t3);
  }
  function j2() {
    for (var n2; n2 = f2.shift(); ) {
      var t3 = n2.__H;
      if (n2.__P && t3) try {
        t3.__h.some(z2), t3.__h.some(B2), t3.__h = [];
      } catch (r3) {
        t3.__h = [], c2.__e(r3, n2.__v);
      }
    }
  }
  c2.__b = function(n2) {
    r2 = null, e2 && e2(n2);
  }, c2.__ = function(n2, t3) {
    n2 && t3.__k && t3.__k.__m && (n2.__m = t3.__k.__m), s2 && s2(n2, t3);
  }, c2.__r = function(n2) {
    a2 && a2(n2), t2 = 0;
    var i3 = (r2 = n2.__c).__H;
    i3 && (u2 === r2 ? (i3.__h = [], r2.__h = [], i3.__.some(function(n3) {
      n3.__N && (n3.__ = n3.__N), n3.u = n3.__N = void 0;
    })) : (i3.__h.some(z2), i3.__h.some(B2), i3.__h = [], t2 = 0)), u2 = r2;
  }, c2.diffed = function(n2) {
    v2 && v2(n2);
    var t3 = n2.__c;
    t3 && t3.__H && (t3.__H.__h.length && (1 !== f2.push(t3) && i2 === c2.requestAnimationFrame || ((i2 = c2.requestAnimationFrame) || w2)(j2)), t3.__H.__.some(function(n3) {
      n3.u && (n3.__H = n3.u), n3.u = void 0;
    })), u2 = r2 = null;
  }, c2.__c = function(n2, t3) {
    t3.some(function(n3) {
      try {
        n3.__h.some(z2), n3.__h = n3.__h.filter(function(n4) {
          return !n4.__ || B2(n4);
        });
      } catch (r3) {
        t3.some(function(n4) {
          n4.__h && (n4.__h = []);
        }), t3 = [], c2.__e(r3, n3.__v);
      }
    }), l2 && l2(n2, t3);
  }, c2.unmount = function(n2) {
    m2 && m2(n2);
    var t3, r3 = n2.__c;
    r3 && r3.__H && (r3.__H.__.some(function(n3) {
      try {
        z2(n3);
      } catch (n4) {
        t3 = n4;
      }
    }), r3.__H = void 0, t3 && c2.__e(t3, r3.__v));
  };
  var k2 = "function" == typeof requestAnimationFrame;
  function w2(n2) {
    var t3, r3 = function() {
      clearTimeout(u4), k2 && cancelAnimationFrame(t3), setTimeout(n2);
    }, u4 = setTimeout(r3, 35);
    k2 && (t3 = requestAnimationFrame(r3));
  }
  function z2(n2) {
    var t3 = r2, u4 = n2.__c;
    "function" == typeof u4 && (n2.__c = void 0, u4()), r2 = t3;
  }
  function B2(n2) {
    var t3 = r2;
    n2.__c = n2.__(), r2 = t3;
  }
  function C2(n2, t3) {
    return !n2 || n2.length !== t3.length || t3.some(function(t4, r3) {
      return t4 !== n2[r3];
    });
  }
  function D2(n2, t3) {
    return "function" == typeof t3 ? t3(n2) : t3;
  }

  // src/client/lib/router.ts
  function parseHash(hash) {
    const h3 = hash ?? window.location.hash ?? "#/";
    const path = h3.slice(1);
    const addFeatureMatch = path.match(/^\/projects\/([^/]+)\/add-feature$/);
    if (addFeatureMatch) return { page: "add-feature", id: addFeatureMatch[1] };
    const projectMatch = path.match(/^\/projects\/([^/]+)$/);
    if (projectMatch) return { page: "project-detail", id: projectMatch[1] };
    const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch) return { page: "session-view", id: sessionMatch[1] };
    if (path === "/new") return { page: "new-project" };
    if (path === "/settings") return { page: "settings" };
    return { page: "dashboard" };
  }
  function navigate(path) {
    window.location.hash = path;
  }
  function useRouter() {
    const [route, setRoute] = d2(() => parseHash());
    y2(() => {
      const onHashChange = () => setRoute(parseHash());
      window.addEventListener("hashchange", onHashChange);
      return () => window.removeEventListener("hashchange", onHashChange);
    }, []);
    return route;
  }

  // src/client/lib/api.ts
  var ApiError = class extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
      this.name = "ApiError";
    }
  };
  async function request(method, path, body) {
    const opts = {
      method,
      headers: body !== void 0 ? { "Content-Type": "application/json" } : void 0,
      body: body !== void 0 ? JSON.stringify(body) : void 0
    };
    const res = await fetch(`/api${path}`, opts);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, data.error ?? res.statusText);
    }
    if (res.status === 204) return void 0;
    return res.json();
  }
  function get(path) {
    return request("GET", path);
  }
  function post(path, body) {
    return request("POST", path, body);
  }
  function put(path, body) {
    return request("PUT", path, body);
  }

  // src/client/lib/ws.ts
  var MIN_RECONNECT_MS = 500;
  var MAX_RECONNECT_MS = 3e4;
  var WsClient = class {
    ws = null;
    handlers = [];
    lastSeq = 0;
    reconnectDelay = MIN_RECONNECT_MS;
    reconnectTimer = null;
    closed = false;
    path;
    trackSeq;
    /**
     * @param path  WebSocket path, e.g. "/ws/sessions/abc" or "/ws/dashboard"
     * @param opts  Options — trackSeq enables lastSeq tracking for session streams
     */
    constructor(path, opts) {
      this.path = path;
      this.trackSeq = opts?.trackSeq ?? false;
      if (opts?.lastSeq !== void 0) this.lastSeq = opts.lastSeq;
      this.connect();
    }
    /** Register a handler for incoming messages. */
    onMessage(handler) {
      this.handlers.push(handler);
      return () => {
        this.handlers = this.handlers.filter((h3) => h3 !== handler);
      };
    }
    /** Send a JSON message to the server (e.g. input for interview sessions). */
    send(msg) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    }
    /** Permanently close the connection (no reconnect). */
    close() {
      this.closed = true;
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    }
    connect() {
      if (this.closed) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let url = `${proto}//${location.host}${this.path}`;
      if (this.trackSeq && this.lastSeq > 0) {
        url += `?lastSeq=${this.lastSeq}`;
      }
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectDelay = MIN_RECONNECT_MS;
      };
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (this.trackSeq && msg.type === "output") {
          this.lastSeq = msg.seq;
        }
        for (const handler of this.handlers) {
          handler(msg);
        }
      };
      ws.onclose = () => {
        this.ws = null;
        this.scheduleReconnect();
      };
      ws.onerror = () => {
      };
    }
    scheduleReconnect() {
      if (this.closed) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
    }
  };
  function connectSession(sessionId, handler, lastSeq) {
    const client = new WsClient(`/ws/sessions/${sessionId}`, {
      trackSeq: true,
      lastSeq
    });
    client.onMessage(handler);
    return client;
  }
  function connectDashboard(handler) {
    const client = new WsClient("/ws/dashboard");
    client.onMessage(handler);
    return client;
  }

  // node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
  var f3 = 0;
  function u3(e3, t3, n2, o3, i3, u4) {
    t3 || (t3 = {});
    var a3, c3, p3 = t3;
    if ("ref" in p3) for (c3 in p3 = {}, t3) "ref" == c3 ? a3 = t3[c3] : p3[c3] = t3[c3];
    var l3 = { type: e3, props: p3, key: n2, ref: a3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --f3, __i: -1, __u: 0, __source: i3, __self: u4 };
    if ("function" == typeof e3 && (a3 = e3.defaultProps)) for (c3 in a3) void 0 === p3[c3] && (p3[c3] = a3[c3]);
    return l.vnode && l.vnode(l3), l3;
  }

  // src/client/components/dashboard.tsx
  function statusBadge(project) {
    if (project.status === "onboarding") return { label: "onboarding", color: "#2196f3" };
    if (project.status === "error") return { label: "error", color: "#f44336" };
    if (!project.activeSession) return { label: "idle", color: "#666" };
    switch (project.activeSession.state) {
      case "running":
        return { label: "running", color: "#4caf50" };
      case "waiting-for-input":
        return { label: "waiting", color: "#ff9800" };
      default:
        return { label: project.activeSession.state, color: "#666" };
    }
  }
  function ProjectCard({ project }) {
    const badge = statusBadge(project);
    const { taskSummary } = project;
    return /* @__PURE__ */ u3(
      "div",
      {
        onClick: () => navigate(`/projects/${project.id}`),
        style: {
          border: "1px solid #333",
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "12px",
          cursor: "pointer",
          background: "#1a1a2e"
        },
        children: [
          /* @__PURE__ */ u3("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }, children: [
            /* @__PURE__ */ u3("span", { style: { fontWeight: "bold", fontSize: "1rem" }, children: project.name }),
            /* @__PURE__ */ u3(
              "span",
              {
                style: {
                  fontSize: "0.75rem",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: badge.color,
                  color: "#fff"
                },
                children: badge.label
              }
            )
          ] }),
          project.dirMissing && /* @__PURE__ */ u3("div", { style: { fontSize: "0.8rem", color: "#ff8a80", marginBottom: "4px" }, children: "Directory missing from disk" }),
          /* @__PURE__ */ u3("div", { style: { fontSize: "0.85rem", color: "#aaa" }, children: [
            taskSummary.completed,
            "/",
            taskSummary.total,
            " tasks",
            taskSummary.blocked > 0 && /* @__PURE__ */ u3("span", { style: { color: "#ff9800", marginLeft: "8px" }, children: [
              taskSummary.blocked,
              " blocked"
            ] })
          ] })
        ]
      }
    );
  }
  function DiscoveredCard({ dir, onOnboarded }) {
    const [busy, setBusy] = d2(false);
    const [errMsg, setErrMsg] = d2(null);
    const handleOnboard = async () => {
      setBusy(true);
      setErrMsg(null);
      try {
        const resp = await post("/projects/onboard", { name: dir.name, path: dir.path });
        onOnboarded(dir, resp);
      } catch (err) {
        setErrMsg(err instanceof Error ? err.message : "Onboard failed");
        setBusy(false);
      }
    };
    const { isGitRepo, hasSpecKit } = dir;
    const hasBadges = isGitRepo || hasSpecKit.spec || hasSpecKit.plan || hasSpecKit.tasks;
    return /* @__PURE__ */ u3(
      "div",
      {
        style: {
          border: "1px dashed #555",
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "12px",
          background: "#12121f"
        },
        children: [
          /* @__PURE__ */ u3("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
            /* @__PURE__ */ u3("span", { style: { fontWeight: "bold", fontSize: "1rem" }, children: dir.name }),
            /* @__PURE__ */ u3(
              "button",
              {
                onClick: handleOnboard,
                disabled: busy,
                style: {
                  fontSize: "0.8rem",
                  padding: "4px 12px",
                  borderRadius: "4px",
                  border: "1px solid #7c8dff",
                  background: "transparent",
                  color: busy ? "#555" : "#7c8dff",
                  cursor: busy ? "default" : "pointer"
                },
                children: busy ? "Onboarding..." : "Onboard"
              }
            )
          ] }),
          hasBadges && /* @__PURE__ */ u3("div", { style: { display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }, children: [
            isGitRepo && /* @__PURE__ */ u3("span", { style: { fontSize: "0.7rem", padding: "1px 6px", borderRadius: "3px", background: "#2a3a2a", color: "#81c784", border: "1px solid #4caf5044" }, children: "git" }),
            hasSpecKit.spec && /* @__PURE__ */ u3("span", { style: { fontSize: "0.7rem", padding: "1px 6px", borderRadius: "3px", background: "#1a2a3a", color: "#90caf9", border: "1px solid #2196f344" }, children: "spec" }),
            hasSpecKit.plan && /* @__PURE__ */ u3("span", { style: { fontSize: "0.7rem", padding: "1px 6px", borderRadius: "3px", background: "#1a2a3a", color: "#90caf9", border: "1px solid #2196f344" }, children: "plan" }),
            hasSpecKit.tasks && /* @__PURE__ */ u3("span", { style: { fontSize: "0.7rem", padding: "1px 6px", borderRadius: "3px", background: "#1a2a3a", color: "#90caf9", border: "1px solid #2196f344" }, children: "tasks" })
          ] }),
          errMsg && /* @__PURE__ */ u3("div", { style: { color: "#ff8a80", fontSize: "0.8rem", marginTop: "8px" }, children: errMsg })
        ]
      }
    );
  }
  function Dashboard() {
    const [data, setData] = d2(null);
    const [error, setError] = d2(null);
    const [loading, setLoading] = d2(true);
    y2(() => {
      get("/projects").then((resp) => {
        setData(resp);
        setLoading(false);
      }).catch((err) => {
        setError(err.message);
        setLoading(false);
      });
    }, []);
    y2(() => {
      const client = connectDashboard((msg) => {
        if (msg.type !== "project-update") return;
        const update = msg;
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            registered: prev.registered.map(
              (p3) => p3.id === update.projectId ? {
                ...p3,
                taskSummary: update.taskSummary,
                activeSession: update.activeSession
              } : p3
            )
          };
        });
      });
      return () => client.close();
    }, []);
    const handleOnboarded = (dir, resp) => {
      setData((prev) => {
        if (!prev) return prev;
        const newRegistered = {
          type: "registered",
          id: resp.projectId,
          name: resp.name,
          dir: resp.path,
          taskFile: "tasks.md",
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: "onboarding",
          taskSummary: { total: 0, completed: 0, blocked: 0, skipped: 0, remaining: 0 },
          activeSession: null,
          dirMissing: false
        };
        return {
          ...prev,
          registered: [...prev.registered, newRegistered],
          discovered: prev.discovered.filter((d3) => d3.path !== dir.path)
        };
      });
    };
    if (loading) return /* @__PURE__ */ u3("div", { children: "Loading projects..." });
    if (error) return /* @__PURE__ */ u3("div", { style: { color: "#f44336" }, children: [
      "Error: ",
      error
    ] });
    if (!data) return null;
    const { registered, discovered, discoveryError } = data;
    return /* @__PURE__ */ u3("div", { children: [
      /* @__PURE__ */ u3("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }, children: [
        /* @__PURE__ */ u3("h2", { style: { margin: 0, fontSize: "1.2rem" }, children: "Projects" }),
        /* @__PURE__ */ u3(
          "a",
          {
            href: "#/new",
            style: {
              color: "#7c8dff",
              textDecoration: "none",
              fontSize: "0.9rem"
            },
            children: "+ New Project"
          }
        )
      ] }),
      discoveryError && /* @__PURE__ */ u3("div", { style: {
        background: "#2a1a1a",
        border: "1px solid #f4433666",
        borderRadius: "8px",
        padding: "12px 16px",
        marginBottom: "16px",
        color: "#ff8a80",
        fontSize: "0.85rem"
      }, children: discoveryError }),
      registered.length > 0 && /* @__PURE__ */ u3("div", { style: { marginBottom: "24px" }, children: registered.map((p3) => /* @__PURE__ */ u3(ProjectCard, { project: p3 }, p3.id)) }),
      discovered.length > 0 && /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3("h3", { style: { margin: "0 0 12px 0", fontSize: "1rem", color: "#aaa" }, children: "Discovered" }),
        discovered.map((d3) => /* @__PURE__ */ u3(DiscoveredCard, { dir: d3, onOnboarded: handleOnboarded }, d3.path))
      ] }),
      registered.length === 0 && discovered.length === 0 && !discoveryError && /* @__PURE__ */ u3("div", { style: { color: "#888", textAlign: "center", padding: "32px 0" }, children: [
        "No projects found. ",
        /* @__PURE__ */ u3("a", { href: "#/new", style: { color: "#7c8dff" }, children: "Create one" }),
        " or register via API."
      ] })
    ] });
  }

  // src/client/components/project-detail.tsx
  var statusIcon = {
    checked: "[x]",
    unchecked: "[ ]",
    blocked: "[?]",
    skipped: "[~]"
  };
  var statusColor = {
    checked: "#4caf50",
    unchecked: "#888",
    blocked: "#ff9800",
    skipped: "#666"
  };
  var sessionStateColor = {
    running: "#4caf50",
    "waiting-for-input": "#ff9800",
    completed: "#666",
    failed: "#f44336"
  };
  function TaskItem({ task }) {
    return /* @__PURE__ */ u3(
      "div",
      {
        style: {
          padding: "4px 0",
          paddingLeft: `${task.depth * 16}px`,
          fontSize: "0.85rem",
          color: task.status === "checked" || task.status === "skipped" ? "#666" : "#ccc"
        },
        children: [
          /* @__PURE__ */ u3("span", { style: { color: statusColor[task.status], fontFamily: "monospace", marginRight: "8px" }, children: statusIcon[task.status] }),
          /* @__PURE__ */ u3("span", { style: { color: "#888", marginRight: "6px" }, children: task.id }),
          task.description,
          task.blockedReason && /* @__PURE__ */ u3("div", { style: { color: "#ff9800", fontSize: "0.8rem", marginLeft: "32px", marginTop: "2px" }, children: task.blockedReason })
        ]
      }
    );
  }
  function SessionRow({ session }) {
    const stateColor2 = sessionStateColor[session.state] ?? "#666";
    const date = new Date(session.startedAt).toLocaleString();
    return /* @__PURE__ */ u3(
      "div",
      {
        onClick: () => navigate(`/sessions/${session.id}`),
        style: {
          padding: "8px 12px",
          borderBottom: "1px solid #333",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.85rem"
        },
        children: [
          /* @__PURE__ */ u3("div", { children: [
            /* @__PURE__ */ u3("span", { style: { color: "#aaa" }, children: session.type }),
            /* @__PURE__ */ u3("span", { style: { color: "#666", marginLeft: "8px" }, children: date })
          ] }),
          /* @__PURE__ */ u3(
            "span",
            {
              style: {
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: "4px",
                background: stateColor2,
                color: "#fff"
              },
              children: session.state
            }
          )
        ]
      }
    );
  }
  function ProjectDetail({ id }) {
    const [project, setProject] = d2(null);
    const [error, setError] = d2(null);
    const [loading, setLoading] = d2(true);
    const [starting, setStarting] = d2(false);
    const [stopping, setStopping] = d2(false);
    const fetchProject = () => {
      get(`/projects/${id}`).then((data) => {
        setProject(data);
        setLoading(false);
      }).catch((err) => {
        setError(err.message);
        setLoading(false);
      });
    };
    y2(() => {
      fetchProject();
    }, [id]);
    const startSession = async () => {
      setStarting(true);
      try {
        await post(`/projects/${id}/sessions`, { type: "task-run" });
        fetchProject();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setStarting(false);
      }
    };
    const stopSession = async () => {
      if (!project?.activeSession) return;
      setStopping(true);
      try {
        await post(`/sessions/${project.activeSession.id}/stop`);
        fetchProject();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setStopping(false);
      }
    };
    if (loading) return /* @__PURE__ */ u3("div", { children: "Loading project..." });
    if (error && !project) return /* @__PURE__ */ u3("div", { style: { color: "#f44336" }, children: [
      "Error: ",
      error
    ] });
    if (!project) return /* @__PURE__ */ u3("div", { style: { color: "#f44336" }, children: "Project not found" });
    const { taskSummary, tasks, activeSession, sessions } = project;
    const phases = /* @__PURE__ */ new Map();
    for (const task of tasks) {
      const key = `Phase ${task.phase}: ${task.phaseName}`;
      const list = phases.get(key) ?? [];
      list.push(task);
      phases.set(key, list);
    }
    return /* @__PURE__ */ u3("div", { children: [
      error && /* @__PURE__ */ u3("div", { style: { color: "#f44336", marginBottom: "12px", fontSize: "0.85rem" }, children: error }),
      /* @__PURE__ */ u3("div", { style: { marginBottom: "16px" }, children: [
        /* @__PURE__ */ u3("h2", { style: { margin: "0 0 4px 0", fontSize: "1.2rem" }, children: project.name }),
        /* @__PURE__ */ u3("div", { style: { color: "#888", fontSize: "0.8rem" }, children: project.dir })
      ] }),
      /* @__PURE__ */ u3("div", { style: { marginBottom: "16px", padding: "12px", background: "#1a1a2e", borderRadius: "8px", border: "1px solid #333" }, children: [
        /* @__PURE__ */ u3("div", { style: { fontSize: "0.9rem", marginBottom: "8px" }, children: [
          /* @__PURE__ */ u3("strong", { children: taskSummary.completed }),
          "/",
          taskSummary.total,
          " tasks completed",
          taskSummary.blocked > 0 && /* @__PURE__ */ u3("span", { style: { color: "#ff9800", marginLeft: "12px" }, children: [
            taskSummary.blocked,
            " blocked"
          ] }),
          taskSummary.skipped > 0 && /* @__PURE__ */ u3("span", { style: { color: "#666", marginLeft: "12px" }, children: [
            taskSummary.skipped,
            " skipped"
          ] })
        ] }),
        taskSummary.total > 0 && /* @__PURE__ */ u3("div", { style: { background: "#333", borderRadius: "4px", height: "6px", overflow: "hidden" }, children: /* @__PURE__ */ u3(
          "div",
          {
            style: {
              width: `${taskSummary.completed / taskSummary.total * 100}%`,
              height: "100%",
              background: "#4caf50",
              borderRadius: "4px"
            }
          }
        ) })
      ] }),
      /* @__PURE__ */ u3("div", { style: { marginBottom: "16px", display: "flex", gap: "8px", alignItems: "center" }, children: activeSession ? /* @__PURE__ */ u3(k, { children: [
        /* @__PURE__ */ u3(
          "span",
          {
            style: {
              fontSize: "0.75rem",
              padding: "2px 8px",
              borderRadius: "4px",
              background: sessionStateColor[activeSession.state] ?? "#666",
              color: "#fff"
            },
            children: activeSession.state
          }
        ),
        /* @__PURE__ */ u3(
          "button",
          {
            onClick: () => navigate(`/sessions/${activeSession.id}`),
            style: {
              padding: "6px 16px",
              background: "#7c8dff",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem"
            },
            children: "View Session"
          }
        ),
        activeSession.state === "running" && /* @__PURE__ */ u3(
          "button",
          {
            onClick: stopSession,
            disabled: stopping,
            style: {
              padding: "6px 16px",
              background: "#f44336",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
              opacity: stopping ? 0.6 : 1
            },
            children: stopping ? "Stopping..." : "Stop"
          }
        )
      ] }) : /* @__PURE__ */ u3(k, { children: [
        /* @__PURE__ */ u3(
          "button",
          {
            onClick: startSession,
            disabled: starting || taskSummary.remaining === 0,
            style: {
              padding: "6px 16px",
              background: taskSummary.remaining === 0 ? "#666" : "#4caf50",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: taskSummary.remaining === 0 ? "default" : "pointer",
              fontSize: "0.85rem",
              opacity: starting ? 0.6 : 1
            },
            children: starting ? "Starting..." : taskSummary.remaining === 0 ? "All Tasks Done" : "Start Task Run"
          }
        ),
        /* @__PURE__ */ u3(
          "button",
          {
            onClick: () => navigate(`/projects/${id}/add-feature`),
            style: {
              padding: "6px 16px",
              background: "#7c8dff",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem"
            },
            children: "Add Feature"
          }
        )
      ] }) }),
      /* @__PURE__ */ u3("div", { style: { marginBottom: "16px" }, children: [
        /* @__PURE__ */ u3("h3", { style: { margin: "0 0 8px 0", fontSize: "1rem" }, children: "Tasks" }),
        Array.from(phases.entries()).map(([phaseName, phaseTasks]) => /* @__PURE__ */ u3("div", { style: { marginBottom: "12px" }, children: [
          /* @__PURE__ */ u3("div", { style: { fontWeight: "bold", fontSize: "0.85rem", color: "#aaa", marginBottom: "4px" }, children: phaseName }),
          phaseTasks.map((task) => /* @__PURE__ */ u3(TaskItem, { task }, task.id))
        ] }, phaseName)),
        tasks.length === 0 && /* @__PURE__ */ u3("div", { style: { color: "#888", fontSize: "0.85rem" }, children: "No tasks found" })
      ] }),
      sessions.length > 0 && /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3("h3", { style: { margin: "0 0 8px 0", fontSize: "1rem" }, children: "Session History" }),
        /* @__PURE__ */ u3("div", { style: { border: "1px solid #333", borderRadius: "8px", overflow: "hidden" }, children: sessions.map((session) => /* @__PURE__ */ u3(SessionRow, { session }, session.id)) })
      ] })
    ] });
  }

  // src/client/components/session-view.tsx
  var streamColor = {
    stdout: "#ccc",
    stderr: "#f44336",
    system: "#7c8dff"
  };
  var stateColor = {
    running: "#4caf50",
    "waiting-for-input": "#ff9800",
    completed: "#666",
    failed: "#f44336"
  };
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i3 = 0; i3 < raw.length; i3++) arr[i3] = raw.charCodeAt(i3);
    return arr;
  }
  function SessionView({ id }) {
    const [session, setSession] = d2(null);
    const [lines, setLines] = d2([]);
    const [error, setError] = d2(null);
    const [loading, setLoading] = d2(true);
    const outputRef = A2(null);
    const autoScrollRef = A2(true);
    const [pushState, setPushState] = d2("unknown");
    const [answer, setAnswer] = d2("");
    const [submitting, setSubmitting] = d2(false);
    const [submitError, setSubmitError] = d2(null);
    y2(() => {
      get(`/sessions/${id}`).then((data) => {
        setSession(data);
        setLoading(false);
      }).catch((err) => {
        setError(err.message);
        setLoading(false);
      });
    }, [id]);
    y2(() => {
      if (!session) return;
      get(`/sessions/${id}/log`).then((entries) => {
        setLines(entries);
      }).catch(() => {
      });
      const lastSeq = 0;
      const client = connectSession(id, (msg) => {
        if (msg.type === "output") {
          const out = msg;
          setLines((prev) => {
            if (prev.length > 0 && prev[prev.length - 1].seq >= out.seq) return prev;
            return [...prev, { ts: out.ts, stream: out.stream, seq: out.seq, content: out.content }];
          });
        } else if (msg.type === "state") {
          const state = msg;
          setSession(
            (prev) => prev ? { ...prev, state: state.state, question: state.question ?? null } : prev
          );
        }
      }, lastSeq);
      return () => client.close();
    }, [session?.id]);
    y2(() => {
      if (autoScrollRef.current && outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    }, [lines]);
    y2(() => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setPushState("denied");
        return;
      }
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setPushState(sub ? "subscribed" : "prompt");
        });
      });
    }, []);
    const subscribePush = q2(async () => {
      if (pushState !== "prompt") return;
      setPushState("subscribing");
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setPushState("denied");
          return;
        }
        const { publicKey } = await get("/push/vapid-key");
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
        const json = sub.toJSON();
        await post("/push/subscribe", {
          endpoint: json.endpoint,
          keys: json.keys
        });
        setPushState("subscribed");
      } catch {
        setPushState("error");
      }
    }, [pushState]);
    const submitAnswer = q2(async () => {
      if (!answer.trim() || submitting) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const updated = await post(`/sessions/${id}/input`, { answer: answer.trim() });
        setSession((prev) => prev ? { ...prev, state: updated.state, pid: updated.pid, question: null } : prev);
        setAnswer("");
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Failed to submit answer");
      } finally {
        setSubmitting(false);
      }
    }, [id, answer, submitting]);
    const handleScroll = () => {
      if (!outputRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
      autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
    };
    if (loading) return /* @__PURE__ */ u3("div", { children: "Loading session..." });
    if (error && !session) return /* @__PURE__ */ u3("div", { style: { color: "#f44336" }, children: [
      "Error: ",
      error
    ] });
    if (!session) return /* @__PURE__ */ u3("div", { style: { color: "#f44336" }, children: "Session not found" });
    const color = stateColor[session.state] ?? "#666";
    return /* @__PURE__ */ u3("div", { style: { display: "flex", flexDirection: "column", height: "calc(100vh - 100px)" }, children: [
      /* @__PURE__ */ u3("div", { style: { marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("span", { style: { fontSize: "0.85rem", color: "#aaa" }, children: session.type }),
          /* @__PURE__ */ u3(
            "span",
            {
              style: {
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: "4px",
                background: color,
                color: "#fff",
                marginLeft: "8px"
              },
              children: session.state
            }
          )
        ] }),
        /* @__PURE__ */ u3("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [
          /* @__PURE__ */ u3("span", { style: { fontSize: "0.8rem", color: "#666" }, children: new Date(session.startedAt).toLocaleString() }),
          pushState === "prompt" && /* @__PURE__ */ u3(
            "button",
            {
              onClick: subscribePush,
              style: {
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: "4px",
                border: "1px solid #7c8dff",
                background: "transparent",
                color: "#7c8dff",
                cursor: "pointer"
              },
              children: "Enable notifications"
            }
          ),
          pushState === "subscribing" && /* @__PURE__ */ u3("span", { style: { fontSize: "0.75rem", color: "#888" }, children: "Subscribing..." }),
          pushState === "subscribed" && /* @__PURE__ */ u3("span", { style: { fontSize: "0.75rem", color: "#4caf50" }, children: "Notifications on" }),
          pushState === "denied" && /* @__PURE__ */ u3("span", { style: { fontSize: "0.75rem", color: "#f44336" }, children: "Notifications blocked" }),
          pushState === "error" && /* @__PURE__ */ u3("span", { style: { fontSize: "0.75rem", color: "#f44336" }, children: "Notification error" })
        ] })
      ] }),
      session.state === "waiting-for-input" && session.question && /* @__PURE__ */ u3(
        "div",
        {
          style: {
            padding: "12px",
            marginBottom: "12px",
            background: "#332800",
            border: "1px solid #ff9800",
            borderRadius: "8px",
            fontSize: "0.9rem"
          },
          children: [
            /* @__PURE__ */ u3("div", { style: { fontWeight: "bold", color: "#ff9800", marginBottom: "4px" }, children: [
              "Input needed",
              session.lastTaskId ? ` (Task ${session.lastTaskId})` : ""
            ] }),
            /* @__PURE__ */ u3("div", { style: { color: "#ddd", marginBottom: "10px" }, children: session.question }),
            /* @__PURE__ */ u3("div", { style: { display: "flex", gap: "8px" }, children: [
              /* @__PURE__ */ u3(
                "input",
                {
                  type: "text",
                  value: answer,
                  onInput: (e3) => setAnswer(e3.target.value),
                  onKeyDown: (e3) => {
                    if (e3.key === "Enter" && !e3.shiftKey) {
                      e3.preventDefault();
                      submitAnswer();
                    }
                  },
                  placeholder: "Type your answer...",
                  disabled: submitting,
                  style: {
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: "4px",
                    border: "1px solid #555",
                    background: "#1a1a2e",
                    color: "#ddd",
                    fontSize: "0.85rem",
                    outline: "none"
                  }
                }
              ),
              /* @__PURE__ */ u3(
                "button",
                {
                  onClick: submitAnswer,
                  disabled: submitting || !answer.trim(),
                  style: {
                    padding: "8px 16px",
                    borderRadius: "4px",
                    border: "none",
                    background: submitting || !answer.trim() ? "#555" : "#ff9800",
                    color: "#fff",
                    fontSize: "0.85rem",
                    cursor: submitting || !answer.trim() ? "default" : "pointer"
                  },
                  children: submitting ? "Sending..." : "Submit"
                }
              )
            ] }),
            submitError && /* @__PURE__ */ u3("div", { style: { color: "#f44336", fontSize: "0.8rem", marginTop: "6px" }, children: submitError })
          ]
        }
      ),
      /* @__PURE__ */ u3(
        "div",
        {
          ref: outputRef,
          onScroll: handleScroll,
          style: {
            flex: 1,
            overflow: "auto",
            background: "#0d0d1a",
            borderRadius: "8px",
            border: "1px solid #333",
            padding: "8px 12px",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          },
          children: [
            lines.map((entry) => /* @__PURE__ */ u3("div", { style: { color: streamColor[entry.stream] ?? "#ccc" }, children: entry.stream === "system" ? /* @__PURE__ */ u3("span", { style: { fontStyle: "italic" }, children: [
              "[",
              entry.stream,
              "] ",
              entry.content
            ] }) : entry.content }, entry.seq)),
            lines.length === 0 && /* @__PURE__ */ u3("div", { style: { color: "#666" }, children: session.state === "running" ? "Waiting for output..." : "No output" })
          ]
        }
      )
    ] });
  }

  // src/client/lib/voice.ts
  var SILENCE_TIMEOUT_MS = 5e3;
  var currentBackend = "browser";
  var stateListeners = [];
  var interimListeners = [];
  var currentState = "idle";
  function setState(state) {
    currentState = state;
    for (const listener of stateListeners) {
      listener(state);
    }
  }
  function onVoiceStateChange(listener) {
    stateListeners.push(listener);
    return () => {
      stateListeners = stateListeners.filter((l3) => l3 !== listener);
    };
  }
  function emitInterimResult(text) {
    for (const listener of interimListeners) {
      listener(text);
    }
  }
  function setBackend(backend) {
    currentBackend = backend;
  }
  function getBackend() {
    return currentBackend;
  }
  function isBrowserSpeechAvailable() {
    return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
  }
  function transcribe() {
    if (currentBackend === "browser") {
      return transcribeBrowser();
    }
    return transcribeCloud();
  }
  function transcribeBrowser() {
    return new Promise((resolve, reject) => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        reject(new Error("Browser speech recognition is not available"));
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      let finalTranscript = "";
      let silenceTimer = null;
      const resetSilenceTimer = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => recognition.stop(), SILENCE_TIMEOUT_MS);
      };
      recognition.onstart = () => {
        setState("listening");
        resetSilenceTimer();
      };
      recognition.onresult = (event) => {
        resetSilenceTimer();
        let interimTranscript = "";
        for (let i3 = event.resultIndex; i3 < event.results.length; i3++) {
          const result = event.results[i3];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }
        emitInterimResult(finalTranscript + interimTranscript);
      };
      recognition.onerror = (event) => {
        if (silenceTimer) clearTimeout(silenceTimer);
        setState("idle");
        reject(new Error(`Speech recognition error: ${event.error}`));
      };
      recognition.onend = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        setState("idle");
        resolve(finalTranscript);
      };
      recognition.start();
    });
  }
  async function transcribeCloud() {
    setState("listening");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    const chunks = [];
    const audioBlob = await new Promise((resolve) => {
      mediaRecorder.ondataavailable = (e3) => {
        if (e3.data.size > 0) chunks.push(e3.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        resolve(new Blob(chunks, { type: mediaRecorder.mimeType }));
      };
      mediaRecorder.start();
      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
      }, 3e4);
    });
    setState("processing");
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    const res = await fetch("/api/voice/transcribe", {
      method: "POST",
      body: formData
    });
    if (!res.ok) {
      setState("idle");
      const data2 = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(data2.error ?? "Voice transcription failed");
    }
    const data = await res.json();
    setState("idle");
    return data.text;
  }

  // src/client/components/spec-kit-chat.tsx
  var PHASES = ["specify", "clarify", "plan", "tasks", "analyze"];
  var phaseLabel = {
    specify: "Specify",
    clarify: "Clarify",
    plan: "Plan",
    tasks: "Tasks",
    analyze: "Analyze",
    implementation: "Implementing"
  };
  function SpecKitChat({ sessionId: initialSessionId, initialPhase, initialState, completionRoute }) {
    const [sessionId, setSessionId] = d2(initialSessionId);
    const [currentPhase, setCurrentPhase] = d2(initialPhase);
    const [sessionState, setSessionState] = d2(initialState);
    const [lines, setLines] = d2([]);
    const [question, setQuestion] = d2(null);
    const [userInput, setUserInput] = d2("");
    const [voiceState, setVoiceState] = d2("idle");
    const outputRef = A2(null);
    const autoScrollRef = A2(true);
    const wsRef = A2(null);
    y2(() => {
      return onVoiceStateChange(setVoiceState);
    }, []);
    y2(() => {
      if (autoScrollRef.current && outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    }, [lines]);
    y2(() => {
      if (!sessionId) return;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      const client = connectSession(sessionId, (msg) => {
        if (msg.type === "output") {
          const out = msg;
          setLines((prev) => {
            if (prev.length > 0 && prev[prev.length - 1].seq >= out.seq) return prev;
            return [...prev, { ts: out.ts, stream: out.stream, seq: out.seq, content: out.content }];
          });
        } else if (msg.type === "state") {
          const state = msg;
          setSessionState(state.state);
          if (state.state === "waiting-for-input" && state.question) {
            setQuestion(state.question);
          } else {
            setQuestion(null);
          }
        } else if (msg.type === "phase") {
          const phase = msg;
          setCurrentPhase(phase.phase);
          if (phase.phase === "implementation") {
            setTimeout(() => navigate(completionRoute), 2e3);
          }
          if (phase.sessionId !== sessionId) {
            setSessionId(phase.sessionId);
          }
        }
      });
      wsRef.current = client;
      return () => client.close();
    }, [sessionId, completionRoute]);
    const sendInput = q2(() => {
      if (!userInput.trim() || !wsRef.current) return;
      wsRef.current.send({ type: "input", content: userInput.trim() });
      setLines((prev) => [
        ...prev,
        { ts: Date.now(), stream: "system", seq: prev.length + 1e4, content: `> ${userInput.trim()}` }
      ]);
      setUserInput("");
      setQuestion(null);
    }, [userInput]);
    const handleVoice = q2(async () => {
      try {
        const text = await transcribe();
        if (text) {
          setUserInput(text);
        }
      } catch {
      }
    }, []);
    const handleScroll = () => {
      if (!outputRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
      autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
    };
    const phaseIndex = currentPhase ? PHASES.indexOf(currentPhase) : -1;
    return /* @__PURE__ */ u3("div", { style: { display: "flex", flexDirection: "column", height: "calc(100vh - 100px)" }, children: [
      /* @__PURE__ */ u3("div", { style: { display: "flex", gap: "4px", marginBottom: "12px", alignItems: "center", flexWrap: "wrap" }, children: [
        PHASES.map((phase, i3) => {
          const isActive = phase === currentPhase;
          const isDone = phaseIndex > i3;
          return /* @__PURE__ */ u3("div", { style: { display: "flex", alignItems: "center", gap: "4px" }, children: [
            i3 > 0 && /* @__PURE__ */ u3("span", { style: { color: "#555", fontSize: "0.7rem" }, children: "\u2192" }),
            /* @__PURE__ */ u3(
              "span",
              {
                style: {
                  fontSize: "0.75rem",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: isActive ? "#7c8dff" : isDone ? "#4caf50" : "#333",
                  color: isActive || isDone ? "#fff" : "#888",
                  fontWeight: isActive ? "bold" : "normal"
                },
                children: phaseLabel[phase] ?? phase
              }
            )
          ] }, phase);
        }),
        currentPhase === "implementation" && /* @__PURE__ */ u3("div", { style: { display: "flex", alignItems: "center", gap: "4px" }, children: [
          /* @__PURE__ */ u3("span", { style: { color: "#555", fontSize: "0.7rem" }, children: "\u2192" }),
          /* @__PURE__ */ u3(
            "span",
            {
              style: {
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: "4px",
                background: "#4caf50",
                color: "#fff",
                fontWeight: "bold"
              },
              children: "Implementing"
            }
          )
        ] })
      ] }),
      sessionState && /* @__PURE__ */ u3("div", { style: { fontSize: "0.8rem", color: "#888", marginBottom: "8px" }, children: [
        "Phase: ",
        phaseLabel[currentPhase ?? ""] ?? currentPhase,
        " \u2014 ",
        sessionState
      ] }),
      /* @__PURE__ */ u3(
        "div",
        {
          ref: outputRef,
          onScroll: handleScroll,
          style: {
            flex: 1,
            overflow: "auto",
            background: "#0d0d1a",
            borderRadius: "8px",
            border: "1px solid #333",
            padding: "8px 12px",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          },
          children: [
            lines.map((entry) => /* @__PURE__ */ u3(
              "div",
              {
                style: {
                  color: entry.stream === "stderr" ? "#f44336" : entry.stream === "system" ? "#7c8dff" : "#ccc"
                },
                children: entry.stream === "system" ? /* @__PURE__ */ u3("span", { style: { fontStyle: "italic" }, children: entry.content }) : entry.content
              },
              entry.seq
            )),
            lines.length === 0 && /* @__PURE__ */ u3("div", { style: { color: "#666" }, children: "Waiting for output..." })
          ]
        }
      ),
      /* @__PURE__ */ u3("div", { style: { marginTop: "8px", display: "flex", gap: "8px" }, children: [
        /* @__PURE__ */ u3(
          "input",
          {
            type: "text",
            value: userInput,
            onInput: (e3) => setUserInput(e3.target.value),
            onKeyDown: (e3) => {
              if (e3.key === "Enter" && !e3.shiftKey) {
                e3.preventDefault();
                sendInput();
              }
            },
            placeholder: question ? "Type your answer..." : "Type a message...",
            style: {
              flex: 1,
              padding: "10px 12px",
              borderRadius: "4px",
              border: "1px solid #555",
              background: "#1a1a2e",
              color: "#ddd",
              fontSize: "0.85rem",
              outline: "none"
            }
          }
        ),
        /* @__PURE__ */ u3(
          "button",
          {
            onClick: handleVoice,
            disabled: voiceState !== "idle",
            title: "Voice input",
            style: {
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              border: "none",
              background: voiceState === "listening" ? "#f44336" : voiceState === "processing" ? "#ff9800" : "#333",
              color: "#fff",
              cursor: voiceState !== "idle" ? "default" : "pointer",
              fontSize: "1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0
            },
            children: voiceState === "listening" ? "..." : voiceState === "processing" ? "~" : "M"
          }
        ),
        /* @__PURE__ */ u3(
          "button",
          {
            onClick: sendInput,
            disabled: !userInput.trim(),
            style: {
              padding: "10px 16px",
              borderRadius: "4px",
              border: "none",
              background: !userInput.trim() ? "#555" : "#7c8dff",
              color: "#fff",
              cursor: !userInput.trim() ? "default" : "pointer",
              fontSize: "0.85rem",
              flexShrink: 0
            },
            children: "Send"
          }
        )
      ] }),
      question && /* @__PURE__ */ u3(
        "div",
        {
          style: {
            marginTop: "8px",
            padding: "8px 12px",
            background: "#332800",
            border: "1px solid #ff9800",
            borderRadius: "4px",
            fontSize: "0.85rem",
            color: "#ff9800"
          },
          children: question
        }
      )
    ] });
  }

  // src/client/components/new-project.tsx
  function NewProject() {
    const [name, setName] = d2("");
    const [description, setDescription] = d2("");
    const [starting, setStarting] = d2(false);
    const [error, setError] = d2(null);
    const [sessionId, setSessionId] = d2(null);
    const [currentPhase, setCurrentPhase] = d2(null);
    const [sessionState, setSessionState] = d2(null);
    const [voiceState, setVoiceState] = d2("idle");
    y2(() => {
      return onVoiceStateChange(setVoiceState);
    }, []);
    const startWorkflow = q2(async () => {
      if (!name.trim() || !description.trim() || starting) return;
      setStarting(true);
      setError(null);
      try {
        const result = await post("/workflows/new-project", {
          name: name.trim(),
          description: description.trim()
        });
        setSessionId(result.sessionId);
        setCurrentPhase(result.phase);
        setSessionState(result.state);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start workflow");
        setStarting(false);
      }
    }, [name, description, starting]);
    const handleVoice = q2(async () => {
      try {
        const text = await transcribe();
        if (text) {
          setDescription(text);
        }
      } catch {
      }
    }, []);
    if (!sessionId) {
      return /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3("h2", { style: { margin: "0 0 16px 0", fontSize: "1.2rem" }, children: "New Project" }),
        error && /* @__PURE__ */ u3("div", { style: { color: "#f44336", marginBottom: "12px", fontSize: "0.85rem" }, children: error }),
        /* @__PURE__ */ u3("div", { style: { marginBottom: "12px" }, children: [
          /* @__PURE__ */ u3("label", { style: { display: "block", fontSize: "0.85rem", color: "#aaa", marginBottom: "4px" }, children: "Repository name" }),
          /* @__PURE__ */ u3(
            "input",
            {
              type: "text",
              value: name,
              onInput: (e3) => setName(e3.target.value),
              placeholder: "my-project",
              style: {
                width: "100%",
                padding: "10px 12px",
                borderRadius: "4px",
                border: "1px solid #555",
                background: "#1a1a2e",
                color: "#ddd",
                fontSize: "0.9rem",
                outline: "none",
                boxSizing: "border-box"
              }
            }
          )
        ] }),
        /* @__PURE__ */ u3("div", { style: { marginBottom: "16px" }, children: [
          /* @__PURE__ */ u3("label", { style: { display: "block", fontSize: "0.85rem", color: "#aaa", marginBottom: "4px" }, children: "Describe your idea" }),
          /* @__PURE__ */ u3("div", { style: { position: "relative" }, children: [
            /* @__PURE__ */ u3(
              "textarea",
              {
                value: description,
                onInput: (e3) => setDescription(e3.target.value),
                placeholder: "Describe what you want to build...",
                rows: 4,
                style: {
                  width: "100%",
                  padding: "10px 12px",
                  paddingRight: "44px",
                  borderRadius: "4px",
                  border: "1px solid #555",
                  background: "#1a1a2e",
                  color: "#ddd",
                  fontSize: "0.9rem",
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "inherit",
                  boxSizing: "border-box"
                }
              }
            ),
            /* @__PURE__ */ u3(
              "button",
              {
                onClick: handleVoice,
                disabled: voiceState !== "idle",
                title: "Speak your idea",
                style: {
                  position: "absolute",
                  right: "8px",
                  top: "8px",
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  border: "none",
                  background: voiceState === "listening" ? "#f44336" : voiceState === "processing" ? "#ff9800" : "#333",
                  color: "#fff",
                  cursor: voiceState !== "idle" ? "default" : "pointer",
                  fontSize: "1rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                },
                children: voiceState === "listening" ? "..." : voiceState === "processing" ? "~" : "M"
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ u3(
          "button",
          {
            onClick: startWorkflow,
            disabled: starting || !name.trim() || !description.trim(),
            style: {
              padding: "10px 24px",
              background: starting || !name.trim() || !description.trim() ? "#555" : "#7c8dff",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: starting || !name.trim() || !description.trim() ? "default" : "pointer",
              fontSize: "0.9rem"
            },
            children: starting ? "Starting..." : "Start Project"
          }
        )
      ] });
    }
    return /* @__PURE__ */ u3(
      SpecKitChat,
      {
        sessionId,
        initialPhase: currentPhase ?? "specify",
        initialState: sessionState ?? "running",
        completionRoute: "/"
      }
    );
  }

  // src/client/components/add-feature.tsx
  function AddFeature({ projectId }) {
    const [description, setDescription] = d2("");
    const [starting, setStarting] = d2(false);
    const [error, setError] = d2(null);
    const [sessionId, setSessionId] = d2(null);
    const [currentPhase, setCurrentPhase] = d2(null);
    const [sessionState, setSessionState] = d2(null);
    const [voiceState, setVoiceState] = d2("idle");
    y2(() => {
      return onVoiceStateChange(setVoiceState);
    }, []);
    const startWorkflow = q2(async () => {
      if (!description.trim() || starting) return;
      setStarting(true);
      setError(null);
      try {
        const result = await post(`/projects/${projectId}/add-feature`, {
          description: description.trim()
        });
        setSessionId(result.sessionId);
        setCurrentPhase(result.phase);
        setSessionState(result.state);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start workflow");
        setStarting(false);
      }
    }, [description, starting, projectId]);
    const handleVoice = q2(async () => {
      try {
        const text = await transcribe();
        if (text) {
          setDescription(text);
        }
      } catch {
      }
    }, []);
    if (!sessionId) {
      return /* @__PURE__ */ u3("div", { children: [
        /* @__PURE__ */ u3("h2", { style: { margin: "0 0 16px 0", fontSize: "1.2rem" }, children: "Add Feature" }),
        error && /* @__PURE__ */ u3("div", { style: { color: "#f44336", marginBottom: "12px", fontSize: "0.85rem" }, children: error }),
        /* @__PURE__ */ u3("div", { style: { marginBottom: "16px" }, children: [
          /* @__PURE__ */ u3("label", { style: { display: "block", fontSize: "0.85rem", color: "#aaa", marginBottom: "4px" }, children: "Describe the feature" }),
          /* @__PURE__ */ u3("div", { style: { position: "relative" }, children: [
            /* @__PURE__ */ u3(
              "textarea",
              {
                value: description,
                onInput: (e3) => setDescription(e3.target.value),
                placeholder: "Describe the feature you want to add...",
                rows: 4,
                style: {
                  width: "100%",
                  padding: "10px 12px",
                  paddingRight: "44px",
                  borderRadius: "4px",
                  border: "1px solid #555",
                  background: "#1a1a2e",
                  color: "#ddd",
                  fontSize: "0.9rem",
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "inherit",
                  boxSizing: "border-box"
                }
              }
            ),
            /* @__PURE__ */ u3(
              "button",
              {
                onClick: handleVoice,
                disabled: voiceState !== "idle",
                title: "Speak your feature idea",
                style: {
                  position: "absolute",
                  right: "8px",
                  top: "8px",
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  border: "none",
                  background: voiceState === "listening" ? "#f44336" : voiceState === "processing" ? "#ff9800" : "#333",
                  color: "#fff",
                  cursor: voiceState !== "idle" ? "default" : "pointer",
                  fontSize: "1rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                },
                children: voiceState === "listening" ? "..." : voiceState === "processing" ? "~" : "M"
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ u3(
          "button",
          {
            onClick: startWorkflow,
            disabled: starting || !description.trim(),
            style: {
              padding: "10px 24px",
              background: starting || !description.trim() ? "#555" : "#7c8dff",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: starting || !description.trim() ? "default" : "pointer",
              fontSize: "0.9rem"
            },
            children: starting ? "Starting..." : "Add Feature"
          }
        )
      ] });
    }
    return /* @__PURE__ */ u3(
      SpecKitChat,
      {
        sessionId,
        initialPhase: currentPhase ?? "specify",
        initialState: sessionState ?? "running",
        completionRoute: `/projects/${projectId}`
      }
    );
  }

  // src/client/components/settings.tsx
  function Settings() {
    const [voiceBackend, setVoiceBackend] = d2(getBackend());
    const [health, setHealth] = d2(null);
    const [logLevel, setLogLevel] = d2("info");
    const [pushPermission, setPushPermission] = d2("default");
    const [error, setError] = d2(null);
    const [saving, setSaving] = d2(false);
    y2(() => {
      get("/health").then(setHealth).catch(() => setError("Failed to load server health"));
      if ("Notification" in window) {
        setPushPermission(Notification.permission);
      }
    }, []);
    const handleVoiceBackendChange = (backend) => {
      setBackend(backend);
      setVoiceBackend(backend);
    };
    const handleLogLevelChange = async (level) => {
      setSaving(true);
      setError(null);
      try {
        await put("/config/log-level", { level });
        setLogLevel(level);
      } catch {
        setError("Failed to update log level");
      } finally {
        setSaving(false);
      }
    };
    const handleRequestPush = async () => {
      if (!("Notification" in window)) return;
      const result = await Notification.requestPermission();
      setPushPermission(result);
    };
    const browserSpeechAvailable = isBrowserSpeechAvailable();
    const cloudSttAvailable = health?.cloudSttAvailable ?? false;
    return /* @__PURE__ */ u3("div", { children: [
      /* @__PURE__ */ u3("h2", { style: { marginTop: 0 }, children: "Settings" }),
      /* @__PURE__ */ u3("section", { style: { marginBottom: "24px" }, children: [
        /* @__PURE__ */ u3("h3", { children: "Voice Backend" }),
        /* @__PURE__ */ u3("label", { style: { display: "block", marginBottom: "8px", cursor: "pointer" }, children: [
          /* @__PURE__ */ u3(
            "input",
            {
              type: "radio",
              name: "voice",
              checked: voiceBackend === "browser",
              onChange: () => handleVoiceBackendChange("browser"),
              disabled: !browserSpeechAvailable
            }
          ),
          " ",
          "Browser (Web Speech API)",
          !browserSpeechAvailable && /* @__PURE__ */ u3("span", { style: { color: "#f44", marginLeft: "8px" }, children: "unavailable" })
        ] }),
        /* @__PURE__ */ u3("label", { style: { display: "block", cursor: "pointer" }, children: [
          /* @__PURE__ */ u3(
            "input",
            {
              type: "radio",
              name: "voice",
              checked: voiceBackend === "cloud",
              onChange: () => handleVoiceBackendChange("cloud"),
              disabled: !cloudSttAvailable
            }
          ),
          " ",
          "Google Speech-to-Text (Cloud)",
          !cloudSttAvailable && /* @__PURE__ */ u3("span", { style: { color: "#f44", marginLeft: "8px" }, children: "unavailable" })
        ] })
      ] }),
      /* @__PURE__ */ u3("section", { style: { marginBottom: "24px" }, children: [
        /* @__PURE__ */ u3("h3", { children: "Log Level" }),
        /* @__PURE__ */ u3(
          "select",
          {
            value: logLevel,
            onChange: (e3) => handleLogLevelChange(e3.target.value),
            disabled: saving,
            style: { padding: "4px 8px", background: "#222", color: "#eee", border: "1px solid #555", borderRadius: "4px" },
            children: ["debug", "info", "warn", "error", "fatal"].map((level) => /* @__PURE__ */ u3("option", { value: level, children: level }, level))
          }
        )
      ] }),
      /* @__PURE__ */ u3("section", { style: { marginBottom: "24px" }, children: [
        /* @__PURE__ */ u3("h3", { children: "Push Notifications" }),
        /* @__PURE__ */ u3("p", { children: [
          "Permission: ",
          /* @__PURE__ */ u3("strong", { children: pushPermission })
        ] }),
        pushPermission === "default" && /* @__PURE__ */ u3(
          "button",
          {
            onClick: handleRequestPush,
            style: { padding: "6px 12px", background: "#335", color: "#eee", border: "1px solid #557", borderRadius: "4px", cursor: "pointer" },
            children: "Enable Notifications"
          }
        ),
        pushPermission === "denied" && /* @__PURE__ */ u3("p", { style: { color: "#f44" }, children: "Notifications are blocked. Update your browser settings to enable them." })
      ] }),
      /* @__PURE__ */ u3("section", { style: { marginBottom: "24px" }, children: [
        /* @__PURE__ */ u3("h3", { children: "Server Info" }),
        health ? /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("p", { children: [
            "Status: ",
            health.status
          ] }),
          /* @__PURE__ */ u3("p", { children: [
            "Uptime: ",
            Math.floor(health.uptime),
            "s"
          ] }),
          /* @__PURE__ */ u3("p", { children: [
            "Sandbox: ",
            health.sandboxAvailable ? "available" : "unavailable"
          ] })
        ] }) : /* @__PURE__ */ u3("p", { style: { color: "#888" }, children: "Loading..." })
      ] }),
      /* @__PURE__ */ u3("section", { children: [
        /* @__PURE__ */ u3("h3", { children: "About" }),
        /* @__PURE__ */ u3("p", { children: "Agent Runner v0.1.0" })
      ] }),
      error && /* @__PURE__ */ u3("p", { style: { color: "#f44" }, children: error })
    ] });
  }

  // src/client/app.tsx
  function App() {
    const route = useRouter();
    return /* @__PURE__ */ u3("div", { children: [
      /* @__PURE__ */ u3("header", { style: { padding: "12px 16px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: "12px" }, children: [
        /* @__PURE__ */ u3("a", { href: "#/", style: { color: "#7c8dff", textDecoration: "none", fontWeight: "bold", fontSize: "1.1rem" }, children: "Agent Runner" }),
        route.page !== "dashboard" && /* @__PURE__ */ u3("a", { href: "#/", style: { color: "#888", textDecoration: "none", fontSize: "0.85rem" }, children: "Back" }),
        /* @__PURE__ */ u3("div", { style: { marginLeft: "auto" }, children: /* @__PURE__ */ u3("a", { href: "#/settings", style: { color: "#888", textDecoration: "none", fontSize: "0.85rem" }, children: "Settings" }) })
      ] }),
      /* @__PURE__ */ u3("main", { style: { padding: "16px" }, children: [
        route.page === "dashboard" && /* @__PURE__ */ u3(Dashboard, {}),
        route.page === "project-detail" && /* @__PURE__ */ u3(ProjectDetail, { id: route.id }),
        route.page === "session-view" && /* @__PURE__ */ u3(SessionView, { id: route.id }),
        route.page === "new-project" && /* @__PURE__ */ u3(NewProject, {}),
        route.page === "add-feature" && /* @__PURE__ */ u3(AddFeature, { projectId: route.id }),
        route.page === "settings" && /* @__PURE__ */ u3(Settings, {})
      ] })
    ] });
  }
  J(/* @__PURE__ */ u3(App, {}), document.getElementById("app"));
})();
