import { useState } from 'react';
import {
  ACTION_CATEGORIES,
  ACTIONS,
  type ActionDefinition,
  searchActions,
} from '../data/actionCatalog';

interface ActionExplorerProps {
  onSelectAction: (action: ActionDefinition) => void;
}

export default function ActionExplorer({ onSelectAction }: ActionExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  const filteredActions = searchQuery
    ? searchActions(searchQuery)
    : ACTIONS;

  const categorizedActions = ACTION_CATEGORIES.map((category) => ({
    ...category,
    actions: filteredActions.filter((action) => action.category === category.id),
  }));

  const handleActionClick = (action: ActionDefinition) => {
    setExpandedAction(expandedAction === action.id ? null : action.id);
  };

  const handleUseAction = (action: ActionDefinition) => {
    onSelectAction(action);
  };

  const impactColors = {
    NONE: 'text-slate-600',
    LOW: 'text-blue-600',
    MEDIUM: 'text-yellow-600',
    HIGH: 'text-red-600',
  };

  const reversibilityLabels = {
    FULL: 'Fully reversible',
    PARTIAL: 'Partially reversible',
    NONE: 'Irreversible',
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          Action Catalogue
        </h3>
        <p className="text-sm text-slate-600 mb-4">
          Browse all available actions with descriptions, parameters, and examples.
          Click an action to see details, then use it to populate your request.
        </p>
        <input
          type="text"
          placeholder="Search actions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-3">
        {categorizedActions.map((category) => {
          if (category.actions.length === 0) return null;

          const isExpanded = expandedCategory === category.id;

          return (
            <div key={category.id} className="border border-slate-200 rounded-lg">
              <button
                onClick={() =>
                  setExpandedCategory(isExpanded ? null : category.id)
                }
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{category.icon}</span>
                  <div className="text-left">
                    <h4 className="font-semibold text-slate-900">
                      {category.name}
                    </h4>
                    <p className="text-sm text-slate-600">
                      {category.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">
                    {category.actions.length}{' '}
                    {category.actions.length === 1 ? 'action' : 'actions'}
                  </span>
                  <svg
                    className={`w-5 h-5 text-slate-400 transition-transform ${
                      isExpanded ? 'transform rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-200 bg-slate-50 p-2">
                  <div className="space-y-2">
                    {category.actions.map((action) => {
                      const isActionExpanded = expandedAction === action.id;

                      return (
                        <div
                          key={action.id}
                          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
                        >
                          <button
                            onClick={() => handleActionClick(action)}
                            className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-slate-900 mb-1">
                                  {action.name}
                                  {action.readOnly && (
                                    <span className="ml-2 text-xs text-slate-500 font-normal">
                                      (read-only)
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-slate-600 mb-2">
                                  {action.description}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-slate-500">
                                  <span>{action.agent}</span>
                                  <span className={impactColors[action.impact]}>
                                    {action.impact} impact
                                  </span>
                                  <span>
                                    {reversibilityLabels[action.reversibility]}
                                  </span>
                                </div>
                              </div>
                              <svg
                                className={`w-5 h-5 text-slate-400 transition-transform flex-shrink-0 ${
                                  isActionExpanded ? 'transform rotate-180' : ''
                                }`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 9l-7 7-7-7"
                                />
                              </svg>
                            </div>
                          </button>

                          {isActionExpanded && (
                            <div className="border-t border-slate-200 p-4 bg-slate-50 space-y-4">
                              {/* Parameters */}
                              <div>
                                <h5 className="text-sm font-semibold text-slate-900 mb-2">
                                  Parameters
                                </h5>
                                <div className="space-y-2">
                                  {action.parameters.map((param) => (
                                    <div
                                      key={param.name}
                                      className="text-sm bg-white p-3 rounded border border-slate-200"
                                    >
                                      <div className="flex items-baseline gap-2 mb-1">
                                        <code className="text-blue-600 font-mono text-xs">
                                          {param.name}
                                        </code>
                                        <span className="text-slate-500 text-xs">
                                          {param.type}
                                        </span>
                                        {param.required && (
                                          <span className="text-red-500 text-xs">
                                            required
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-slate-600 mb-1">
                                        {param.description}
                                      </div>
                                      {param.example && (
                                        <div className="text-xs text-slate-500">
                                          Example:{' '}
                                          <code className="bg-slate-100 px-1 rounded">
                                            {param.example}
                                          </code>
                                        </div>
                                      )}
                                      {param.constraints && (
                                        <div className="text-xs text-slate-500 mt-1">
                                          {param.constraints}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Examples */}
                              <div>
                                <h5 className="text-sm font-semibold text-slate-900 mb-2">
                                  Example Requests
                                </h5>
                                <div className="space-y-1">
                                  {action.examples.map((example, idx) => (
                                    <div
                                      key={idx}
                                      className="text-sm text-slate-700 bg-white px-3 py-2 rounded border border-slate-200"
                                    >
                                      "{example}"
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Restrictions */}
                              {action.restrictions && action.restrictions.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-semibold text-slate-900 mb-2">
                                    Restrictions
                                  </h5>
                                  <ul className="space-y-1">
                                    {action.restrictions.map((restriction, idx) => (
                                      <li
                                        key={idx}
                                        className="text-sm text-slate-600 flex items-start gap-2"
                                      >
                                        <span className="text-yellow-600 mt-0.5">
                                          ⚠️
                                        </span>
                                        <span>{restriction}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Use Action Button */}
                              <button
                                onClick={() => handleUseAction(action)}
                                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                              >
                                Use This Action
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredActions.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          No actions found matching "{searchQuery}"
        </div>
      )}
    </div>
  );
}
