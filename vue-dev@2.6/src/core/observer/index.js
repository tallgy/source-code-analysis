/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor (value: any) {
    this.value = value
    this.dep = new Dep()
    this.vmCount = 0
    def(value, '__ob__', this)
    if (Array.isArray(value)) {
      if (hasProto) {
        protoAugment(value, arrayMethods)
      } else {
        copyAugment(value, arrayMethods, arrayKeys)
      }
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment (target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  // 不是对象， 或者 属于 VNode 的实例，return
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  // 代表存在了 observe 实例
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    // 需要监听
    shouldObserve &&
    // 不处于服务端渲染
    !isServerRendering() &&
    // 是一个数组 或者 纯对象 (Object.prototype.toString.call)
    //  方法的值为 '[object Object]'
    (Array.isArray(value) || isPlainObject(value)) &&
    // 使用 isExtensible 来判断对象是不是一个可以扩展的
    Object.isExtensible(value) &&
    // 暂不了解
    !value._isVue
  ) {
    // 就会 new 一个 Observer 实例，
    // Observer 实例里面就是将其内部递归式的实例化和响应式。
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/*
* 这里就是初始化数据的响应式, 这里是使用的 line:67 是使用的Object.keys,按理是不会获取到原型上的。
* */
/**
 * Define a reactive property on an Object.
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  // new 一个dep数组
  const dep = new Dep()

  // 获取到自身key值上的属性, getOwnProperty 代表的就是获取自身的，不是原型上的
  // 但是我们看到上面，是使用的Object.keys 所以说应该不会出现原型上面的key的。（后续再看为什么）
  // Descriptor 描述，就是获取属性的描述
  const property = Object.getOwnPropertyDescriptor(obj, key)
  // 如果 configurable 属性为 false 则直接return
  // 如果对于一个 对象使用了 Object.freeze 则 configurable 也会为false，
  if (property && property.configurable === false) {
    return
  }

  // 取出 getter 和 setter
  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  // getter不存在 || 存在setter 并且 参数只携带了两个，则对val进行赋值
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  // shallow，不携带默认为false，创建观察者实例。
  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      // 如果存在getter方法，则执行getter方法，这个是可行的。
      const value = getter ? getter.call(obj) : val
      if (Dep.target) {
        dep.depend()
        // 存在子部的递归，则将子部加入依赖
        if (childOb) {
          // 添加进入 dep 依赖。
          childOb.dep.depend()
          if (Array.isArray(value)) {
            // 如果这个是数组，那么则会进行一个数组的依赖
            dependArray(value)
          }
        }
      }
      return value
    },
    // set,只有一个参数
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      // 代表没有改变，则不需要进行触发DOM的修改
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      // process.env.NODE_ENV 存在 development production 两种，
      // development 代表是本地开发环境，
      // production 代表是线上环境
      // 如果不属于线上环境，且存在customSetter，则触发方法
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // #7981: for accessor properties without setter
      // 如果没有 setter 属性则 return，但是不知道为什么需要getter
      if (getter && !setter) return
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      // 同时需要对新的值进行创建 observe 实例
      childOb = !shallow && observe(newVal)
      // 然后再 notify 分发进行通知
      dep.notify()
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  if (!ob) {
    target[key] = val
    return val
  }
  defineReactive(ob.value, key, val)
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
