import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/Login.vue') },
    {
      path: '/',
      component: () => import('./views/Layout.vue'),
      children: [
        { path: '', redirect: '/home' },
        { path: 'home', component: () => import('./views/Home.vue') },
        { path: 'my', component: () => import('./views/resident/MyOrders.vue'), meta: { roles: ['resident'] } },
        { path: 'new', component: () => import('./views/resident/NewOrder.vue'), meta: { roles: ['resident'] } },
        { path: 'orders/:id', component: () => import('./views/OrderDetail.vue') },
        { path: 'agenda', component: () => import('./views/tech/Agenda.vue'), meta: { roles: ['technician'] } },
        { path: 'exceptions', component: () => import('./views/cs/ExceptionCenter.vue'), meta: { roles: ['cs', 'admin', 'warehouse', 'technician', 'resident'] } },
        { path: 'parts', component: () => import('./views/warehouse/Parts.vue'), meta: { roles: ['warehouse', 'admin'] } },
        { path: 'dashboard', component: () => import('./views/admin/Dashboard.vue'), meta: { roles: ['admin', 'cs'] } },
        { path: 'technicians', component: () => import('./views/admin/Technicians.vue'), meta: { roles: ['admin'] } },
        { path: 'archives', component: () => import('./views/admin/Archives.vue'), meta: { roles: ['admin', 'cs'] } },
      ],
    },
  ],
})

router.beforeEach(to => {
  const token = localStorage.getItem('token')
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  if (to.path === '/login') return true
  if (!token || !user) return '/login'
  const roles = to.meta.roles as string[] | undefined
  if (roles && !roles.includes(user.role)) return '/home'
  return true
})

export default router
