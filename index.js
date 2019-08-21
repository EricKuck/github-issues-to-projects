const { Toolkit } = require( 'actions-toolkit' );


Toolkit.run( async ( tools ) => {
  try {
    const { action, issue } = tools.context.payload;

    tools.log("${ action }");
    tools.log("${ issue }");
    tools.log("${ tools.context.payload }");

    // Get the arguments
    const projectName = tools.arguments._[ 0 ];
    const inboxColumnName  = tools.arguments._[ 1 ];
    const assignedColumnName  = tools.arguments._[ 2 ];
    
    const secret = process.env.GH_PAT ? process.env.GH_PAT : process.env.GITHUB_TOKEN;

    if( action === 'opened' ){
      tools.log('Creating a card for an open issue…')
    } else if (action === 'assigned' && (!issue.assignee || issue.assignee.length === 0)) {
      tools.log('Moving card for an assigned issue…')
    } else {
      tools.exit.success('Performing no actions')
    }

    const columnName = action === 'opened' ? inboxColumnName : assignedColumnName

    // Fetch the column ids and names
    const { resource } = await tools.github.graphql({
      query: `query {
        resource( url: "${ issue.html_url }" ) {
          ... on Issue {
            projectCards {
              nodes {
                id
                column {
                  name
                }
              }
            }
            repository {
              projects( search: "${ projectName }", first: 10, states: [OPEN] ) {
                nodes {
                  columns( first: 100 ) {
                    nodes {
                      id
                      name
                    }
                  }
                }
              }
              owner {
                ... on Organization {
                  projects( search: "${ projectName }", first: 10, states: [OPEN] ) {
                    nodes {
                      columns( first: 100 ) {
                        nodes {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      headers: {
        authorization: `token ${ secret }`
      }
    });

    const cardId = resource.projectCards.nodes 
      && resource.projectCards.nodes[ 0 ]
      && resource.projectCards.nodes[ 0 ].id
      || null;
    
    var currentColumn;
    if (action === 'assigned' && (!issue.assignee || issue.assignee.length === 0)) {
      currentColumn = resource.projectCards.nodes
      && resource.projectCards.nodes[ 0 ]
      && resource.projectCards.nodes[ 0 ].column.name
      || null;

      if( cardId === null || currentColumn === null ){
        tools.exit.failure( `The issue ${ issue.title } is not in a project.` );
      }

      if( currentColumn !== inboxColumnName ){
        tools.exit.success( `The issue ${ issue.title } has already advanced from ${ inboxColumnName }.` );
      }
    } else if (action === 'opened' && cardId) {
      tools.exit.success( `The issue ${ issue.title } has already been added to the proejct.` );
    } else {
      currentColumn = null;
    }


    // Get an array of all matching projects
    const repoProjects = resource.repository.projects.nodes || [];
    const orgProjects = resource.repository.owner
      && resource.repository.owner.projects
      && resource.repository.owner.projects.nodes
      || [];
    
    // Get the columns with matching names
    const columns = [ ...repoProjects, ...orgProjects ]
      .flatMap( projects => {
        return projects.columns.nodes
          ? projects.columns.nodes.filter( column => column.name === columnName )
          : [];
      });

    // Check we have a valid column ID
    if( !columns.length ) {
      tools.exit.failure( `Could not find "${ projectName }" with "${ columnName }" column` );
    }

    // Do the card thing
    const cardAction = columns.map( column => {
      return new Promise( async( resolve, reject ) => {            
        try {
          await tools.github.graphql({
            query: action === 'opened' ?
            `mutation {
                addProjectCard( input: { contentId: "${ issue.node_id }", projectColumnId: "${ column.id }" }) {
                  clientMutationId
                }
              }` :
              `mutation {
                moveProjectCard( input: { cardId: "${ cardId }", columnId: "${ column.id }" }) {
                  clientMutationId
                }
              }`,
            headers: {
              authorization: `token ${ secret }`
            }
          });

          resolve();
        }
        catch( error ){
          reject( error );
        }
      })
    });

    // Wait for completion
    await Promise.all( cardAction ).catch( error => tools.exit.failure( error ) );

    // Log success message
    if (action === 'opened') {
      tools.log.success( `Added ${ issue.title } to ${ projectName } in ${ columnName }.` );
    } else if (action == 'assigned') {
        tools.log.success( `Moved newly assigned issue ${ issue.title } to ${ columnName }.` );
    }
  }
  catch( error ){
    tools.exit.failure( error );
  }
}, {
  event: [ 'issues' ],
  secrets: [ 'GITHUB_TOKEN' ],
})
