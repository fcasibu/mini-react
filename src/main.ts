import { component } from './create-component';
import { FrameworkOrchestrator } from './framework-orchestrator';
import { Renderer } from './renderer';
import { StateManager } from './state-manager';
import { TemplateProcessor } from './template-processor';
import type { ComponentDefinition, MountedComponentInstance } from './types';

const frameworkOrchestrator = FrameworkOrchestrator.getInstance();
const processor = new TemplateProcessor();
const stateManager = new StateManager(frameworkOrchestrator);
const renderer = new Renderer(frameworkOrchestrator, stateManager);

// TODO(fcasibu): $effect

export { component };

export function html(
  staticStrings: TemplateStringsArray,
  ...expressions: unknown[]
) {
  return processor.process(staticStrings, expressions);
}

export function render(
  definition: ComponentDefinition,
  container: HTMLElement,
) {
  const mountedInstance = renderer.mount(definition, container);

  function addInstances(
    instance: MountedComponentInstance | MountedComponentInstance[],
  ) {
    if (Array.isArray(instance)) {
      instance.forEach(addInstances);
      return;
    }

    frameworkOrchestrator.addMountedInstance(instance);

    instance.childInstanceMap.forEach((child) => addInstances(child));
  }

  addInstances(mountedInstance);
}

export function $state<T>(newValue?: T | ((prev: T) => T)) {
  const currentComponentContext =
    frameworkOrchestrator.getCurrentComponentContext();

  const hookIndex = frameworkOrchestrator.getNextHookIndex();

  return stateManager.registerState<T>(
    currentComponentContext.instanceId,
    hookIndex,
    newValue,
  );
}

const Logo = component(() => {
  return html`<div>Logo</div>`;
});

const Navigation = component(() => {
  const [active, setActive] = $state('home');

  return html`
    <nav>
      <ul>
        <li
          class="${active === 'home' ? 'active' : ''}"
          onclick="${() => setActive('home')}"
        >
          Home
        </li>
        <li
          class="${active === 'services' ? 'active' : ''}"
          onclick="${() => setActive('services')}"
        >
          Services
        </li>
        <li
          class="${active === 'about' ? 'active' : ''}"
          onclick="${() => setActive('about')}"
        >
          About
        </li>
        <li
          class="${active === 'contact' ? 'active' : ''}"
          onclick="${() => setActive('contact')}"
        >
          Contact
        </li>
      </ul>
    </nav>
  `;
});

const HeaderActions = component(() => {
  return html`
    <div>
      <button onclick="${() => alert('Login clicked')}">Login</button>
      <button onclick="${() => alert('Sign Up clicked')}">Sign Up</button>
    </div>
  `;
});

const Header = component(() => {
  return html`
    <header>
      ${Logo({})} ${Navigation({})} ${HeaderActions({})}
      <div>
        <input type="search" placeholder="Search..." />
        <button onclick="${() => alert('Search clicked!')}">Search</button>
      </div>
    </header>
  `;
});

const Comment = component<{
  text: string;
  handleRemoveComents: () => void;
}>(({ text, handleRemoveComents }) => {
  return html`<li onclick="${handleRemoveComents}">${text}</li>`;
});

// TODO(fcasibu): value is not updating after setting it to empty
const Article = component<{ title: string; content: string }>(
  ({ title, content }) => {
    const [likes, setLikes] = $state(0);
    const [comments, setComments] = $state<string[]>(['asd']);
    const [newComment, setNewComment] = $state('');

    return html`
      <article>
        <h2>${title}</h2>
        <p>${content}</p>
        <div>
          <button onclick="${() => setLikes(likes + 1)}">
            Like (${likes})
          </button>
        </div>
        <section>
          <h3>Comments</h3>
          <ul>
            ${comments.map((c, i) =>
              Comment({
                text: c,
                handleRemoveComents: () =>
                  setComments(comments.filter((_, idx) => i !== idx)),
              }),
            )}
          </ul>
          <input
            type="text"
            value="${newComment}"
            oninput="${(e: Event) =>
              setNewComment((e.target as HTMLInputElement).value)}"
            placeholder="Add a comment"
          />
          <button
            onclick="${() => {
              if (newComment.trim() !== '') {
                setComments([...comments, newComment]);
                setNewComment('hahaha');
              }
            }}"
          >
            Add Comment
          </button>
        </section>
      </article>
    `;
  },
);

const Sidebar = component(() => {
  return html`
    <aside>
      <h3>Sidebar</h3>
      <p>Some additional content and useful links:</p>
      <ul>
        <li><a href="#" onclick="${() => alert('Link One')}">Link One</a></li>
        <li><a href="#" onclick="${() => alert('Link Two')}">Link Two</a></li>
        <li>
          <a href="#" onclick="${() => alert('Link Three')}">Link Three</a>
        </li>
      </ul>
    </aside>
  `;
});

const Main = component(() => {
  return html`
    <main>
      <section>
        ${Article({
          title: 'First Article',
          content:
            'This is the content for the first article. It has interactive likes and a comment section.',
        })}
        ${Article({
          title: 'Second Article',
          content:
            'Content for the second article goes here, with more details and interesting information.',
        })}
        ${Article({
          title: 'Third Article',
          content:
            'Here is some more detailed content in the third article, complete with interactive elements.',
        })}
      </section>
      ${Sidebar({})}
    </main>
  `;
});

const FooterNav = component(() => {
  return html`
    <nav>
      <a href="#" onclick="${() => alert('Privacy Policy')}">Privacy Policy</a>
      <a href="#" onclick="${() => alert('Terms of Service')}"
        >Terms of Service</a
      >
      <a href="#" onclick="${() => alert('Contact Us')}">Contact Us</a>
    </nav>
  `;
});

const FooterSocial = component(() => {
  return html`
    <div>
      <a href="#" onclick="${() => alert('Facebook')}">Facebook</a>
      <a href="#" onclick="${() => alert('Twitter')}">Twitter</a>
      <a href="#" onclick="${() => alert('Instagram')}">Instagram</a>
    </div>
  `;
});

const Footer = component(() => {
  return html`
    <footer>
      <div>
        <p>&copy; ${new Date().getFullYear()}. All rights reserved.</p>
        ${FooterNav({})}
      </div>
      ${FooterSocial({})}
    </footer>
  `;
});

const App = component(() => {
  return html` <div>${Header({})} ${Main({})} ${Footer({})}</div> `;
});

render(App({}), document.getElementById('app')!);
