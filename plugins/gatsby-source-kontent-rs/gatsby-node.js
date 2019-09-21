const KontentDelivery = require('@kentico/kontent-delivery');
const changeCase = require('change-case');
const unionBy = require('lodash/unionBy');

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
   * Handles creating Gatsby nodes for all content items.
   */
  async function handleNodeCreation() {
    // Create nodes for all Kontent items.
    const response = await client.items().toPromise();

    const allItems = unionBy(
      response.items,
      response.linkedItems,
      'system.codename',
    );

    allItems.forEach(item => {
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

    interface KontentElement @dontInfer {
      name: String!
      type: String!
    }

    type KontentItemSystem @infer {
      codename: String!
      id: String!
      language: String!
      lastModified: Date! @dateformat
      name: String!
      type: String!
    }

    type KontentAsset @infer {
      name: String!
      description: String
      type: String!
      size: Int!
      url: String!
      width: Int!
      height: Int!
    }

    type KontentAssetElement implements KontentElement @infer {
      name: String!
      type: String!
      value: [KontentAsset]
    }

    type KontentDateTimeElement implements KontentElement @infer {
      name: String!
      type: String!
      value: Date @dateformat
    }

    type KontentModularContentElement implements KontentElement @infer {
      name: String!
      type: String!
      value: [KontentItem] @link(by: "system.codename")
    }

    type KontentMultipleChoiceElement implements KontentElement @infer {
      name: String!
      type: String!
    }

    type KontentNumberElement implements KontentElement @infer {
      name: String!
      type: String!
      value: Float
    }

    type KontentRichTextElement implements KontentElement @infer {
      name: String!
      type: String!
      value: String
      images: [KontentRichTextImage]
      links: [KontentRichTextLink]
      linkedItems: [KontentItem] @link(by: "system.codename")
    }

    type KontentRichTextImage @infer {
      description: String
      height: Int!
      imageId: String!
      url: String!
      width: Int!
    }

    type KontentRichTextLink @infer {
      codename: String!
      linkId: String!
      type: String!
      urlSlug: String!
    }

    type KontentTaxonomyElement implements KontentElement @infer {
      name: String!
      type: String!
      taxonomyGroup: String!
      value: [KontentTaxonomyItem]
    }

    type KontentTaxonomyItem @infer {
      name: String!
      codename: String!
    }

    type KontentTextElement implements KontentElement @infer {
      name: String!
      type: String!
      value: String
    }

    type KontentUrlSlugElement implements KontentElement @infer {
      name: String!
      type: String!
      value: String
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
  const elementPropertyKeys = Object.keys(item).filter(
    key => item[key] && item[key].type,
  );

  // Create object with only element keys.
  const elements = elementPropertyKeys.reduce((acc, key) => {
    const fieldName = getGraphFieldName(key);
    let fieldValue;

    const elementValue = item[key];

    if (elementValue.type === 'modular_content') {
      // Transform modular content fields to support linking.
      fieldValue = {
        name: elementValue.name,
        type: elementValue.type,
        value: elementValue.itemCodenames,
      };
    } else if (elementValue.type === 'rich_text') {
      // Transform rich text fields to support linking.
      fieldValue = {
        images: elementValue.images,
        linkedItems: elementValue.linkedItemCodenames,
        links: elementValue.links,
        name: elementValue.name,
        type: elementValue.type,
        value: elementValue.value,
      };
    } else {
      fieldValue = elementValue;
    }

    // Remove the raw data field.
    delete fieldValue.rawData;

    return Object.assign(acc, { [fieldName]: fieldValue });
  }, {});

  let nodeData = {
    system: item.system,
    elements: elements,
  };

  // Gatsby is not a fan of dealing with types vs plain objects
  // so we'll re-serialize the data to make plain ol' objects!
  nodeData = JSON.parse(JSON.stringify(nodeData));

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
        type: getElementValueType(element.type),
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
 * Return appropriate GraphQL type for Kontent element type.
 * @param {String} elementType
 */
function getElementValueType(elementType) {
  return `Kontent${changeCase.pascalCase(elementType)}Element`;
}

/**
 * Return transformed field name.
 * @param {String} elementName
 */
function getGraphFieldName(elementName) {
  return changeCase.camelCase(elementName);
}

/**
 * Return fully qualified GraphQL type name.
 * @param {String} typeName
 */
function getGraphTypeName(typeName) {
  return `KontentItem${changeCase.pascalCase(typeName)}`;
}

/**
 * Return transformed Gatsby node ID value.
 * @param {KontentDelivery.ContentItem} item
 */
function getNodeIdValue(item) {
  return `${changeCase.paramCase(item.system.type)}-${item.system.id}`;
}
