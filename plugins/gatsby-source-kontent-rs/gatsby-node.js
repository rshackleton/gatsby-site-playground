const KontentDelivery = require('@kentico/kontent-delivery');
const changeCase = require('change-case');

exports.sourceNodes = async (
  { actions, createContentDigest, createNodeId, schema },
  configOptions,
) => {
  const { createNode, createTypes } = actions;

  // Create Kontent Delivery SDK client.
  const client = new KontentDelivery.DeliveryClient({
    projectId: configOptions.projectId,
  });

  await handleTypeCreation();
  await handleNodeCreation();

  /**
   * Handles creating GraphQL types for all content types.
   */
  async function handleTypeCreation() {
    // Create base types for Kontent schema.
    createTypes(createBaseTypes(schema));

    // Create types for all Kontent types.
    const response = await client.types().toPromise();
    createTypes(
      response.types.reduce(
        (acc, type) => acc.concat(createTypeDef(schema, type)),
        [],
      ),
    );
  }

  /**
   * Handles creating Gatbsy nodes for all content items.
   */
  async function handleNodeCreation() {
    // Create nodes for all Kontent items.
    const response = await client.items().toPromise();
    response.items.forEach(item => {
      const itemNode = createItemNode(createContentDigest, createNodeId, item);
      createNode(itemNode);
    });
  }
};

/**
 * Create base GraphQL types to represent Kontent schema.
 * @param {Object} schema
 */
function createBaseTypes(schema) {
  const typeDefs = `
    interface KontentItem @nodeInterface {
      id: ID!
      system: KontentItemSystem!
    }

    type KontentItemSystem @dontInfer {
      codename: String!
      id: String!
      language: String!
      lastModified: Date! @dateformat
      name: String!
      type: String!
    }

    type KontentTextElement @dontInfer {
      name: String!
      type: String!
      value: String!
    }
  `;

  return typeDefs;
}

/**
 * Create Gatsby node for Kontent item.
 * @param {Function} createContentDigest
 * @param {Function} createNodeId
 * @param {KontentDelivery.ContentItem} item
 */
function createItemNode(createContentDigest, createNodeId, item) {
  // Get all keys where the property has a "type" property.
  const elementPropertyKeys = Object.keys(item)
    .filter(key => item[key] && item[key].type)
    // For now we only want to support TextElement for testing. Ignore all others.
    .filter(key => item[key].type === 'text');

  // Create object with only element keys.
  const elements = {};

  elementPropertyKeys.forEach(key => {
    const fieldName = getGraphFieldName(key);
    elements[fieldName] = Object.assign({}, item[key]);
  });

  const nodeData = {
    system: Object.assign({}, item.system),
    elements: elements,
  };

  console.log(nodeData);

  const nodeContent = JSON.stringify(nodeData);

  const nodeMeta = {
    id: createNodeId(getNodeIdValue(nodeData)),
    parent: null,
    children: [],
    internal: {
      type: getGraphTypeName(nodeData.system.type),
      mediaType: 'text/html',
      contentDigest: createContentDigest(nodeData),
    },
  };

  const node = Object.assign({}, nodeData, nodeMeta);

  return node;
}

/**
 * Create GraphQL type definition for Kontent type.
 * @param {Object} schema
 * @param {KontentDelivery.ContentType} type
 */
function createTypeDef(schema, type) {
  // Create field definitions for Kontent type elements.
  const elementFields = type.elements.reduce((acc, element) => {
    const fieldName = getGraphFieldName(element.codename);

    return Object.assign(acc, {
      [fieldName]: {
        type: getGraphQLScalarType(element.type),
      },
    });
  }, {});

  const elementsTypeDef = schema.buildObjectType({
    name: `${getGraphTypeName(type.system.codename)}Elements`,
    fields: elementFields,
    infer: false,
  });

  const typeDef = schema.buildObjectType({
    name: getGraphTypeName(type.system.codename),
    fields: {
      system: 'KontentItemSystem!',
      elements: `${getGraphTypeName(type.system.codename)}Elements`,
    },
    interfaces: ['Node', 'KontentItem'],
    infer: false,
  });

  return [elementsTypeDef, typeDef];
}

/**
 * Return fully qualified GraphQL type name.
 * @param {String} typeName
 */
function getGraphTypeName(typeName) {
  return `KontentItem${changeCase.pascalCase(typeName)}`;
}

/**
 * Return transformed field name.
 * @param {String} elementName
 */
function getGraphFieldName(elementName) {
  return changeCase.camelCase(elementName);
}

/**
 * Return appropriate GraphQL type for Kontent element type.
 * @param {String} elementType
 */
function getGraphQLScalarType(elementType) {
  switch (elementType) {
    case 'asset':
      return 'String';

    case 'date_time':
      return 'Date';

    case 'modular_content':
      return 'String';

    case 'rich_text':
      return 'String';

    case 'taxonomy':
      return 'String';

    case 'text':
      return 'KontentTextElement';

    case 'url_slug':
      return 'String';

    default:
      return 'String';
  }
}

/**
 * Return transformed Gatsby node ID value.
 * @param {KontentDelivery.ContentItem} item
 */
function getNodeIdValue(item) {
  return `${changeCase.paramCase(item.system.type)}-${item.system.id}`;
}
