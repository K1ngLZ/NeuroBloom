// Remap a radial dead zone continuously, preserving the direction on diagonals.
export function projectJoystick(dx,dy,radius,deadZone=.16){
  if(![dx,dy,radius,deadZone].every(Number.isFinite)||radius<=0||deadZone<0||deadZone>=1)return {x:0,y:0,thumbX:0,thumbY:0};
  const distance=Math.hypot(dx,dy);
  if(!distance)return {x:0,y:0,thumbX:0,thumbY:0};
  const extent=Math.min(distance/radius,1),strength=Math.max(0,(extent-deadZone)/(1-deadZone)),nx=dx/distance,ny=dy/distance;
  return {x:nx*strength,y:ny*strength,thumbX:nx*extent*radius,thumbY:ny*extent*radius};
}

export class MovementJoystick {
  constructor(element,{input,isActive=()=>true,onEngage=()=>{},thumb=element.querySelector('#joystickThumb'),windowTarget=element.ownerDocument.defaultView,documentTarget=element.ownerDocument}={}){
    this.element=element;this.thumb=thumb;this.input=input;this.isActive=isActive;this.onEngage=onEngage;this.pointerId=null;this.destroyed=false;this.listeners=[];
    const listen=(target,type,handler)=>{target?.addEventListener(type,handler);this.listeners.push(()=>target?.removeEventListener(type,handler));};
    listen(element,'pointerdown',event=>this.start(event));
    listen(element,'pointermove',event=>{if(event.pointerId!==this.pointerId)return;if(!this.isActive()){this.reset();return;}event.preventDefault();this.move(event);});
    const stop=event=>{if(event.pointerId===this.pointerId)this.reset();};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(element,type,stop);
    listen(element,'contextmenu',event=>event.preventDefault());
    listen(windowTarget,'blur',()=>this.reset());
    listen(windowTarget,'resize',()=>this.reset());
    listen(documentTarget,'visibilitychange',()=>{if(documentTarget.hidden)this.reset();});
    this.reset();
  }
  start(event){
    if(this.destroyed||!this.isActive()||this.pointerId!==null||(event.pointerType==='mouse'&&event.button!==0))return;
    const rect=this.element.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    event.preventDefault();this.pointerId=event.pointerId;
    try{this.element.setPointerCapture(event.pointerId);}catch{this.reset();return;}
    this.element.classList.add('held');this.onEngage();this.move(event);
  }
  move(event){
    const rect=this.element.getBoundingClientRect(),thumb=this.thumb?.getBoundingClientRect(),radius=Math.max(0,(Math.min(rect.width,rect.height)-Math.max(thumb?.width||0,thumb?.height||0))/2);
    const value=projectJoystick(event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2,radius);
    this.input.setAnalog('joystick',value.x,value.y);
    this.element.style.setProperty('--stick-x',`${value.thumbX}px`);this.element.style.setProperty('--stick-y',`${value.thumbY}px`);
  }
  reset(){
    const pointerId=this.pointerId;this.pointerId=null;
    this.input.setAnalog('joystick',0,0);this.element.style.setProperty('--stick-x','0px');this.element.style.setProperty('--stick-y','0px');this.element.classList.remove('held');
    if(pointerId!==null&&this.element.hasPointerCapture(pointerId))this.element.releasePointerCapture(pointerId);
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;this.reset();for(const remove of this.listeners)remove();this.listeners=[];}
}
