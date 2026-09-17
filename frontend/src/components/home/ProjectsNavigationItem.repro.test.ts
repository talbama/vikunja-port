import {describe, it, expect, beforeEach} from 'vitest'
import {defineComponent, h} from 'vue'
import {mount, flushPromises} from '@vue/test-utils'
import {setActivePinia, createPinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import {createRouter, createMemoryHistory} from 'vue-router'

import ProjectsNavigationItem from '@/components/home/ProjectsNavigationItem.vue'
import {useProjectStore} from '@/stores/projects'
import type {IProject} from '@/modelTypes/IProject'
import enMessages from '@/i18n/lang/en.json'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en: enMessages}})

function createTestRouter() {
	return createRouter({
		history: createMemoryHistory(),
		routes: [
			{path: '/projects/:projectId', name: 'project.index', component: {template: '<div />'}},
		],
	})
}

function createMockProject(overrides: Partial<IProject>): IProject {
	return {
		id: 1,
		title: 'Test Project',
		description: '',
		owner: {id: 1, username: 'test', name: '', email: '', created: new Date(), updated: new Date()},
		tasks: [],
		isArchived: false,
		hexColor: '',
		identifier: '',
		backgroundInformation: null,
		isFavorite: false,
		subscription: null as never,
		position: 0,
		backgroundBlurHash: '',
		parentProjectId: 0,
		views: [],
		created: new Date(),
		updated: new Date(),
		...overrides,
	} as IProject
}

async function mountItem(projects: IProject[], parent: IProject) {
	const router = createTestRouter()
	await router.push('/projects/1')
	await router.isReady()

	// The project store can only be created from within a component setup because
	// it depends (transitively, via the base store) on useI18n().
	const Host = defineComponent({
		setup() {
			const projectStore = useProjectStore()
			projectStore.setProjects(projects)
			return () => h(ProjectsNavigationItem, {
				project: parent,
				canCollapse: true,
				canEditOrder: false,
			})
		},
	})

	const wrapper = mount(Host, {
		global: {
			plugins: [i18n, router],
			stubs: {
				Icon: true,
				ProjectSettingsDropdown: true,
				ColorBubble: true,
				BaseButton: {template: '<a><slot /></a>'},
				ProjectsNavigation: {
					props: ['modelValue'],
					template: '<ul><li v-for="p in modelValue" :key="p.id">{{ p.title }}</li></ul>',
				},
			},
		},
	})
	await flushPromises()
	return wrapper
}

describe('ProjectsNavigationItem child project filtering', () => {
	beforeEach(() => {
		setActivePinia(createPinia())
	})

	it('lists the active sub-project and hides the archived one', async () => {
		const parent = createMockProject({id: 1, title: 'Parent Project', parentProjectId: 0})
		const activeChild = createMockProject({id: 2, title: 'Active Child', parentProjectId: 1, isArchived: false})
		const archivedChild = createMockProject({id: 3, title: 'Archived Child', parentProjectId: 1, isArchived: true})

		const wrapper = await mountItem([parent, activeChild, archivedChild], parent)

		expect(wrapper.text()).toContain('Active Child')
		expect(wrapper.text()).not.toContain('Archived Child')
	})
})
