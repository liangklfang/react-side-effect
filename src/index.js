import React, { Component } from 'react';
import ExecutionEnvironment from 'exenv';
import shallowEqual from 'shallowequal';

/*（1）创建一个组件，该组件的prop的改变会被映射到全局的side effect上（因为如果一个组件的props改变，那么该数组中放的所有的组件实例都会调用emitChange，并根据他们的props得到我们最终的state）
  （2）和componentDidMount的不同
      他会收集所有当前整棵树的props才会把他传递给side effect
  （3）API签名：
    withSideEffect: (reducePropsToState, handleStateChangeOnClient, [mapStateOnServer]) -> ReactComponent -> ReactComponent
    这是一个高阶组件，当mounting, unmounting or receiving new props等生命周期方法被调用的时候都会调用reducePropsToState，同时传入每一个已经
    挂载的实例对象的props，你可以操作这些挂载的props然后返回一个state。在客户端，每次这个组件被挂载/卸载或者他的props属性发生变化，reducePropsToState
    都会被调用，同时这个重新计算得到的state对象会被传入到handleStateChangeOnClient，在这个函数中你可以使用这个state去触发side effect；在服务端handleStateChangeOnClient
    不会被触发，但是在调用renderToString后你可以调用返回的组件的静态方法rewind去获取当前的state，如果在调用了renderToString后你忘记了调用rewind，那么内部的组件实例对象的调用栈会
    继续增长，最后会产生内存泄漏和错误的信息，因此在服务端每次调用renderToString后你必须手动调用rewind；在测试环境中，你可以使用返回的组件的静态方法peek,他允许你获取当前的state同时不会
    重置已经挂载的组件的实例栈，但是在非测试环境中不要使用
  （4）调用方式如下，其会返回一个新的组件实例SideEffect
      export default withSideEffect(
        reducePropsToState, //会找到所有的实例对象的props,并得到最终的state
        handleStateChangeOnClient//
      )(BodyStyle);
*/
module.exports = function withSideEffect(
  reducePropsToState,
  handleStateChangeOnClient,
  mapStateOnServer
) {
  if (typeof reducePropsToState !== 'function') {
    throw new Error('Expected reducePropsToState to be a function.');
  }
  if (typeof handleStateChangeOnClient !== 'function') {
    throw new Error('Expected handleStateChangeOnClient to be a function.');
  }
  if (typeof mapStateOnServer !== 'undefined' && typeof mapStateOnServer !== 'function') {
   throw new Error('Expected mapStateOnServer to either be undefined or a function.');
  }

  //包裹元素的displayName，name，如果没有这两个属性，那么返回'Component'字符串
  function getDisplayName(WrappedComponent) {
    return WrappedComponent.displayName || WrappedComponent.name || 'Component';
  }

  //接受一个包裹组件WrappedComponent,同时返回一个组件，也就是SideEffect组件的实例对象
  return function wrap(WrappedComponent) {
    if (typeof WrappedComponent !== 'function') {
      throw new Error('Expected WrappedComponent to be a React component.');
    }

    let mountedInstances = [];
    //已经挂载的组件的实例

    let state;

    //如果组件已经更新，那么对每一个组件实例都调用我们的reducePropsToState方法并得到最终的state
    //如果可以操作DOM，那么我们调用handleStateChangeOnClient方法并传入我们的最终的state，否则
    //调用mapStateOnServer并传入我们的state
    function emitChange() {
      state = reducePropsToState(mountedInstances.map(function (instance) {
        return instance.props;
      }));

      if (SideEffect.canUseDOM) {
        handleStateChangeOnClient(state);
      } else if (mapStateOnServer) {
        state = mapStateOnServer(state);
      }
    }

    //这个类实际上是一个函数，其可以访问我们外部定义的mountedInstances数组，这样每个WrappedComponent实例
    //都是有一个自己的私有的实例数组的！
    class SideEffect extends Component {
      // Try to use displayName of wrapped component
      static displayName = `SideEffect(${getDisplayName(WrappedComponent)})`;
      //静态属性

      // Expose canUseDOM so tests can monkeypatch it
      static canUseDOM = ExecutionEnvironment.canUseDOM;
      //是否可以使用DOM

      //获取当前的state，同时不会重置当前已经挂载的组件实例栈，不要在非测试环境中使用
      static peek() {
        return state;
      }

      //在服务端handleStateChangeOnClient不会被触发，但是在调用renderToString后你可以调用返回的组件的静态方法rewind去获取当前的state，如果在调用了renderToString后你忘记了调用rewind，那么内部的组件实例对象的调用栈会
      //继续增长，最后会产生内存泄漏和错误的信息，因此在服务端每次调用renderToString后你必须手动调用rewind
      static rewind() {
        //服务端才能调用
        if (SideEffect.canUseDOM) {
          throw new Error('You may only call rewind() on the server. Call peek() to read the current state.');
        }
        let recordedState = state;
        state = undefined;
        mountedInstances = [];
        //返回state,但是已经挂载的实例会全部被重置，同时state被重置为null
        return recordedState;
      }
      
      //接受SideEffect的新的props属性，如果属性值不相同那么才会更新组件
      shouldComponentUpdate(nextProps) {
        return !shallowEqual(nextProps, this.props);
      }

      //你每次实例化SideEffect这个类的时候，就会在数组中放入我们的this对象并遍历所有的实例对象得到最终的state
      componentWillMount() {
        mountedInstances.push(this);
        emitChange();
      }
    
      //如果组件已经更新
      componentDidUpdate() {
        emitChange();
      }
      
      //找到卸载的这个组件在数组中的下标并删除，同时调用emitChange
      componentWillUnmount() {
        const index = mountedInstances.indexOf(this);
        mountedInstances.splice(index, 1);
        emitChange();
      }

      //此处的SideEffect实例化传入的props会被传入到我们的包裹组件WrappedComponent中，此处就是高阶组件
      //每一个实例对象都会调用一次render方法
      render() {
        return <WrappedComponent {...this.props} />;
      }
    }

    return SideEffect;
  }
}
