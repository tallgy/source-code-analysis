import {
  NavigationGuard,
  RouteLocationNormalized,
  NavigationGuardNext,
  RouteLocationRaw,
  RouteLocationNormalizedLoaded,
  NavigationGuardNextCallback,
  isRouteLocation,
  Lazy,
  RouteComponent,
  RawRouteComponent,
} from './types'

import {
  createRouterError,
  ErrorTypes,
  NavigationFailure,
  NavigationRedirectError,
} from './errors'
import { ComponentOptions, onUnmounted, onActivated, onDeactivated } from 'vue'
import { inject, getCurrentInstance } from 'vue'
import { matchedRouteKey } from './injectionSymbols'
import { RouteRecordNormalized } from './matcher/types'
import { isESModule } from './utils'
import { warn } from './warning'

function registerGuard(
  record: RouteRecordNormalized,
  name: 'leaveGuards' | 'updateGuards',
  guard: NavigationGuard
) {
  const removeFromList = () => {
    record[name].delete(guard)
  }

  onUnmounted(removeFromList)
  onDeactivated(removeFromList)

  onActivated(() => {
    record[name].add(guard)
  })

  record[name].add(guard)
}

/**
 * Add a navigation guard that triggers whenever the component for the current
 * location is about to be left. Similar to {@link beforeRouteLeave} but can be
 * used in any component. The guard is removed when the component is unmounted.
 *
 * @param leaveGuard - {@link NavigationGuard}
 */
export function onBeforeRouteLeave(leaveGuard: NavigationGuard) {
  if (__DEV__ && !getCurrentInstance()) {
    warn(
      'getCurrentInstance() returned null. onBeforeRouteLeave() must be called at the top of a setup function'
    )
    return
  }

  const activeRecord: RouteRecordNormalized | undefined = inject(
    matchedRouteKey,
    // to avoid warning
    {} as any
  ).value

  if (!activeRecord) {
    __DEV__ &&
      warn(
        'No active route record was found when calling `onBeforeRouteLeave()`. Make sure you call this function inside of a component child of <router-view>. Maybe you called it inside of App.vue?'
      )
    return
  }

  registerGuard(activeRecord, 'leaveGuards', leaveGuard)
}

/**
 * Add a navigation guard that triggers whenever the current location is about
 * to be updated. Similar to {@link beforeRouteUpdate} but can be used in any
 * component. The guard is removed when the component is unmounted.
 *
 * @param updateGuard - {@link NavigationGuard}
 */
export function onBeforeRouteUpdate(updateGuard: NavigationGuard) {
  if (__DEV__ && !getCurrentInstance()) {
    warn(
      'getCurrentInstance() returned null. onBeforeRouteUpdate() must be called at the top of a setup function'
    )
    return
  }

  const activeRecord: RouteRecordNormalized | undefined = inject(
    matchedRouteKey,
    // to avoid warning
    {} as any
  ).value

  if (!activeRecord) {
    __DEV__ &&
      warn(
        'No active route record was found when calling `onBeforeRouteUpdate()`. Make sure you call this function inside of a component child of <router-view>. Maybe you called it inside of App.vue?'
      )
    return
  }

  registerGuard(activeRecord, 'updateGuards', updateGuard)
}

export function guardToPromiseFn(
  guard: NavigationGuard,
  to: RouteLocationNormalized,
  from: RouteLocationNormalizedLoaded
): () => Promise<void>
export function guardToPromiseFn(
  guard: NavigationGuard,
  to: RouteLocationNormalized,
  from: RouteLocationNormalizedLoaded,
  record: RouteRecordNormalized,
  name: string
): () => Promise<void>
export function guardToPromiseFn(
  guard: NavigationGuard,
  to: RouteLocationNormalized,
  from: RouteLocationNormalizedLoaded,
  record?: RouteRecordNormalized,
  name?: string
): () => Promise<void> {
  // keep a reference to the enterCallbackArray to prevent pushing callbacks if a new navigation took place
  // enterCallbacks : Registered beforeRouteEnter callbacks passed to `next` or returned in guards
  // enterCallbackArray 的值会为 undefined，record.enterCallbacks[name!] 和 []
  const enterCallbackArray =
    record &&
    // name is defined if record is because of the function overload
      // 这里的 !这个是ts的语法。因为 name可能会string或者undefined，所以需要使用这个，否则不能使用
      // 这里的作用是，如果 enterCallbacks[name{组件名}] 不存在则返回一个空数组。
    (record.enterCallbacks[name!] = record.enterCallbacks[name!] || [])

  return () =>
      // 返回一个 promise 方法
    new Promise((resolve, reject) => {
      // 定义一个 next 方法
      const next: NavigationGuardNext = (
        valid?: boolean | RouteLocationRaw | NavigationGuardNextCallback | Error
      ) => {
        // 如果 传递一个 false，代表要抛出异常。
        if (valid === false)
          reject(
            createRouterError<NavigationFailure>(
              ErrorTypes.NAVIGATION_ABORTED,
              {
                from,
                to,
              }
            )
          )
        else if (valid instanceof Error) {
          // 如果传递一个 Error 代表要抛出异常
          reject(valid)
        } else if (isRouteLocation(valid)) {
          // 如果为 string 或者为 对象。
          // 就是一个重定向的跳转，所以会reject，但是内部是一个重跳转。
          reject(
            createRouterError<NavigationRedirectError>(
              ErrorTypes.NAVIGATION_GUARD_REDIRECT,
              {
                from: to,
                to: valid,
              }
            )
          )
        } else {
          // 现在就是正常的跳转了。
          // 判断是否存在 enterCallbackArray，只要传递了 record，那么就会存在。
          if (
            enterCallbackArray &&
            // since enterCallbackArray is truthy, both record and name also are
            // 只要 record!.enterCallbacks[name!] 存在就为 ture，正常情况。
            // 如果不存在，那么 enterCallbackArray 会为 []
            record!.enterCallbacks[name!] === enterCallbackArray &&
            // 判断 next 携带的参数是一个函数。
            typeof valid === 'function'
          )
            // 那么就会放进enter的callback方法数组，里面，后续会调用。
            enterCallbackArray.push(valid)
          // 然后 resolve
          resolve()
        }
      }

      // wrapping with Promise.resolve allows it to work with both async and sync guards
      // 使用 call 方法调用自己的周期函数。
      // 第三个参数，如果处于生产环境，则要判断只能next一次，对于不是生产环境直接返回next
      const guardReturn = guard.call(
        record && record.instances[name!],
        to,
        from,
        __DEV__ ? canOnlyBeCalledOnce(next, to, from) : next
      )
      // 使用 Promise 进行了异步的封装。
      let guardCall = Promise.resolve(guardReturn)

      // 就这里，这个是通过方法携带的参数个数进行的判断是否要调用 next 方法。
      if (guard.length < 3) guardCall = guardCall.then(next)
      if (__DEV__ && guard.length > 2) {
        const message = `The "next" callback was never called inside of ${
          guard.name ? '"' + guard.name + '"' : ''
        }:\n${guard.toString()}\n. If you are returning a value instead of calling "next", make sure to remove the "next" parameter from your function.`
        if (typeof guardReturn === 'object' && 'then' in guardReturn) {
          guardCall = guardCall.then(resolvedValue => {
            // @ts-expect-error: _called is added at canOnlyBeCalledOnce
            if (!next._called) {
              warn(message)
              return Promise.reject(new Error('Invalid navigation guard'))
            }
            return resolvedValue
          })
          // TODO: test me!
        } else if (guardReturn !== undefined) {
          // @ts-expect-error: _called is added at canOnlyBeCalledOnce
          if (!next._called) {
            warn(message)
            reject(new Error('Invalid navigation guard'))
            return
          }
        }
      }
      guardCall.catch(err => reject(err))
    })
}

/**
 * 判断，是否多次调用了next
 * 返回的也是一个带有了next的方法，但是内部进行了一个闭包处理，禁止了多次的调用
 * 同时这个是要处于生产环境才会进行的调用
 * @param next
 * @param to
 * @param from
 */
function canOnlyBeCalledOnce(
  next: NavigationGuardNext,
  to: RouteLocationNormalized,
  from: RouteLocationNormalized
): NavigationGuardNext {
  let called = 0
  return function () {
    if (called++ === 1)
      warn(
        `The "next" callback was called more than once in one navigation guard when going from "${from.fullPath}" to "${to.fullPath}". It should be called exactly one time in each navigation guard. This will fail in production.`
      )
    // @ts-expect-error: we put it in the original one because it's easier to check
    next._called = true
    if (called === 1) next.apply(null, arguments as any)
  }
}

type GuardType = 'beforeRouteEnter' | 'beforeRouteUpdate' | 'beforeRouteLeave'

export function extractComponentsGuards(
  matched: RouteRecordNormalized[],
  guardType: GuardType,
  to: RouteLocationNormalized,
  from: RouteLocationNormalizedLoaded
) {
  const guards: Array<() => Promise<void>> = []

  // 循环匹配上的路由
  for (const record of matched) {
    // 获取路由里面的组件，进行循环
    for (const name in record.components) {
      // 取出组件
      let rawComponent = record.components[name]
      // 如果是 开发环境。就要进行一些判断处理
      if (__DEV__) {
        // 如果组件不存在，或者组件的类型不是 对象或者函数。则抛出组件无效异常。
        if (
          !rawComponent ||
          (typeof rawComponent !== 'object' &&
            typeof rawComponent !== 'function')
        ) {
          warn(
            `Component "${name}" in record with path "${record.path}" is not` +
              ` a valid component. Received "${String(rawComponent)}".`
          )
          // throw to ensure we stop here but warn to ensure the message isn't
          // missed by the user
          throw new Error('Invalid route component')
        } else if ('then' in rawComponent) {
          // 判断是否有 then 是否存在。
          // 判断是否是一个promise方法，而不是一个返回promise方法的函数。
          // let c = Promise.resolve(1)
          // if ('then' in c) {
          //   console.log('then')
          // }
          // 将输出 then


          // warn if user wrote import('/component.vue') instead of () =>
          // import('./component.vue')
          warn(
            `Component "${name}" in record with path "${record.path}" is a ` +
              `Promise instead of a function that returns a Promise. Did you ` +
              `write "import('./MyPage.vue')" instead of ` +
              `"() => import('./MyPage.vue')" ? This will break in ` +
              `production if not fixed.`
          )
          // 进行维护，修改。改为了一个返回promise的函数。
          const promise = rawComponent
          rawComponent = () => promise
        } else if (
          // 做了一个 类型的断言，判定为任何类型都可以。
          // 因为下面这两个应该是属于vue的，所以我不清楚是Boolean还是一个什么类型。
          // 但是通过查看 warn，我们知道了，定义了一个异步加载组件。
          // 假设其存在 __asyncLoader 异步加载器？
          // 且 __warnedDefineAsync 不为 true
          (rawComponent as any).__asyncLoader &&
          // warn only once per component
          !(rawComponent as any).__warnedDefineAsync
        ) {
          ;(rawComponent as any).__warnedDefineAsync = true
          warn(
            `Component "${name}" in record with path "${record.path}" is defined ` +
              `using "defineAsyncComponent()". ` +
              `Write "() => import('./MyPage.vue')" instead of ` +
              `"defineAsyncComponent(() => import('./MyPage.vue'))".`
          )
        }
      }

      // 如果未mounted，router 组件，则跳过 update 和 leave 守卫。
      // skip update and leave guards if the route component is not mounted
      // 判断如果不是enter，且还没有实例的时候，continue
      if (guardType !== 'beforeRouteEnter' && !record.instances[name]) continue

      // 判断组件
      if (isRouteComponent(rawComponent)) {
        // __vccOpts is added by vue-class-component and contain the regular options
        // options。为获取的__vccOpts 或者 组件本身
        const options: ComponentOptions =
          (rawComponent as any).__vccOpts || rawComponent
        // guard，对应的自己定义的router声明周期的方法
        const guard = options[guardType]
        // 如果 guard是存在的，那么就会 push 进 guards
        // 此时 push 进去的方法是通过调用了 guardToPromiseFn 来进行的。
        // 这里的 record 是匹配的路由，name就是路由的组件。
        guard && guards.push(guardToPromiseFn(guard, to, from, record, name))
      } else {
        // start requesting the chunk already
        let componentPromise: Promise<
          RouteComponent | null | undefined | void
        > = (rawComponent as Lazy<RouteComponent>)()

        if (__DEV__ && !('catch' in componentPromise)) {
          warn(
            `Component "${name}" in record with path "${record.path}" is a function that does not return a Promise. If you were passing a functional component, make sure to add a "displayName" to the component. This will break in production if not fixed.`
          )
          componentPromise = Promise.resolve(componentPromise as RouteComponent)
        }

        guards.push(() =>
          componentPromise.then(resolved => {
            if (!resolved)
              return Promise.reject(
                new Error(
                  `Couldn't resolve component "${name}" at "${record.path}"`
                )
              )
            const resolvedComponent = isESModule(resolved)
              ? resolved.default
              : resolved
            // replace the function with the resolved component
            record.components[name] = resolvedComponent
            // __vccOpts is added by vue-class-component and contain the regular options
            const options: ComponentOptions =
              (resolvedComponent as any).__vccOpts || resolvedComponent
            const guard = options[guardType]
            return guard && guardToPromiseFn(guard, to, from, record, name)()
          })
        )
      }
    }
  }

  return guards
}

/**
 * Allows differentiating lazy components from functional components and vue-class-component
 * 允许区分惰性组件与功能组件和vue类组件
 *
 * @param component
 */
function isRouteComponent(
  component: RawRouteComponent
): component is RouteComponent {
  // 组件要为对象，且存在 displayName，props，__vccOpts属性
  return (
    typeof component === 'object' ||
    'displayName' in component ||
    'props' in component ||
    '__vccOpts' in component
  )
}
