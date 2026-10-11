export async function initUpdates(api,{isBusy=()=>false,setBusy=()=>{}}={}) {
  const $=id=>document.getElementById(id);
  let checking=false,installing=false;
  function render(result,manual=false) {
    $('appVersion').textContent='v'+result.currentVersion;
    $('automaticUpdates').checked=result.enabled;
    const visible=result.release && result.notify && (manual || result.enabled);
    $('updateNotice').hidden=!visible;
    $('installUpdateRelease').hidden=!result.release?.installer;
    if(result.release) $('updateNoticeText').textContent=`Доступна версия ${result.release.version}. У вас установлена ${result.currentVersion}.`;
    $('updateCheckStatus').textContent=result.status==='unavailable' ? result.message || 'Не удалось проверить обновления. Попробуйте позже.' :
      !result.enabled && !manual ? 'Автоматическая проверка отключена.' :
      result.release ? `На GitHub доступна версия ${result.release.version}.` :
      result.status==='current' ? `Установлена актуальная версия ${result.currentVersion}.` : `Установлена версия ${result.currentVersion}.`;
  }
  async function check(manual=false) {
    if(checking || installing)return;
    checking=true;$('checkUpdatesBtn').disabled=true;
    if(manual)$('updateCheckStatus').textContent='Проверка GitHub…';
    try {render(await api.checkUpdates(manual),manual);}
    catch {$('updateCheckStatus').textContent='Не удалось проверить обновления. Попробуйте позже.';}
    finally {checking=false;$('checkUpdatesBtn').disabled=false;}
  }
  $('checkUpdatesBtn').addEventListener('click',()=>check(true));
  const unsubscribe=api.onUpdateProgress(progress=>{
    $('installUpdateRelease').textContent=progress.percent===100 ? 'Файл проверен' : `Загрузка ${progress.percent}%`;
    $('updateCheckStatus').textContent=`Загрузка обновления: ${progress.percent}%`;
  });
  $('installUpdateRelease').addEventListener('click',async()=>{
    if(installing)return;
    if(isBusy()){$('updateCheckStatus').textContent='Дождитесь завершения разбора или сборки книги.';return;}
    installing=true;setBusy(true);
    const controls=['installUpdateRelease','checkUpdatesBtn','automaticUpdates','dismissUpdateRelease','openUpdateRelease'];
    controls.forEach(id=>{$(id).disabled=true;});
    try {
      const result=await api.installUpdate();
      $('updateCheckStatus').textContent=result.started ? 'Запущен установщик. Завершите установку новой версии.' : 'Обновление отменено.';
    } catch(e) {$('updateCheckStatus').textContent=`Не удалось обновить приложение. ${e.message}`;}
    finally {installing=false;setBusy(false);controls.forEach(id=>{$(id).disabled=false;});$('installUpdateRelease').textContent='Обновить';}
  });
  $('openUpdateRelease').addEventListener('click',async()=>{
    try {await api.openUpdate();}
    catch {$('updateCheckStatus').textContent='Не удалось открыть страницу релиза.';}
  });
  $('dismissUpdateRelease').addEventListener('click',async()=>{
    try {render(await api.dismissUpdate());}
    catch {$('updateCheckStatus').textContent='Не удалось запомнить скрытие уведомления.';}
  });
  $('automaticUpdates').addEventListener('change',async()=>{
    const enabled=$('automaticUpdates').checked;
    try {render(await api.setUpdateChecks(enabled));if(enabled)await check();}
    catch {$('automaticUpdates').checked=!enabled;$('updateCheckStatus').textContent='Не удалось сохранить настройку обновлений.';}
  });
  try {render(await api.updateStatus());await check();}
  catch {$('updateCheckStatus').textContent='Не удалось проверить обновления. Попробуйте позже.';}
  const timer=setInterval(()=>check(),6*60*60*1000);
  window.addEventListener('beforeunload',()=>{clearInterval(timer);unsubscribe();},{once:true});
}
